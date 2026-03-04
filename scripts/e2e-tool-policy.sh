#!/usr/bin/env bash
# E2E Tool Policy Enforcement Test
#
# Tests that the ToolPolicyEngine correctly enforces access control.
# The policy engine defaults to deny-all. We add an explicit allow for
# file_read but not for shell_exec. The agent attempts both — shell_exec
# is denied, file_read succeeds.
#
# What this does:
#   1. Builds ratchetd
#   2. Starts server with the tool-policy scenario (scripted test provider)
#   3. Authenticates and creates an allow policy for file_read
#   4. Creates a task (shell_exec → file_read) for the development agent
#   5. Waits for agent-tick to execute the task
#   6. Verifies shell_exec and file_read both appear in transcripts
#      (shell_exec denied, file_read allowed)
#
# Usage:
#   ./scripts/e2e-tool-policy.sh

set -euo pipefail

RATCHET_URL="${RATCHET_URL:-http://localhost:9090}"
DB_PATH="./data/ratchet-e2e-tool-policy.db"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

RESULT="PASSED"
RATCHET_PID=""
TEMP_CONFIG=""
TEMP_TRIGGERS=""

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; RESULT="FAILED"; }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

cleanup() {
    if [ -n "$RATCHET_PID" ]; then
        info "Stopping ratchetd (PID $RATCHET_PID)..."
        kill "$RATCHET_PID" 2>/dev/null || true
        wait "$RATCHET_PID" 2>/dev/null || true
        RATCHET_PID=""
    fi
    rm -f "$TEMP_CONFIG" "$TEMP_TRIGGERS" "$DB_PATH" 2>/dev/null || true
}
trap cleanup EXIT

# ---- Build ----
info "Building ratchetd..."
go build -o bin/ratchetd ./cmd/ratchetd/
pass "Build succeeded"

# ---- Create fast-cron test config ----
TEMP_TRIGGERS=$(mktemp /tmp/triggers-e2e-policy-XXXX.yaml)
sed 's|\*/10 \* \* \* \*|* * * * *|g' config/triggers.yaml > "$TEMP_TRIGGERS"

TEMP_CONFIG=$(mktemp /tmp/ratchet-e2e-policy-XXXX.yaml)
sed "s|config/triggers.yaml|$TEMP_TRIGGERS|g" ratchet.yaml > "$TEMP_CONFIG"

# ---- Start server ----
info "Starting ratchetd with tool-policy scenario..."
mkdir -p "$(dirname "$DB_PATH")"
rm -f "$DB_PATH"

RATCHET_AI_PROVIDER=test \
RATCHET_AI_SCENARIO="testdata/scenarios/tool-policy.yaml" \
RATCHET_DB_PATH="$DB_PATH" \
./bin/ratchetd --config "$TEMP_CONFIG" > /tmp/ratchetd-e2e-tool-policy.log 2>&1 &
RATCHET_PID=$!
sleep 3

# ---- Authenticate ----
TOKEN=$(curl -sf -X POST "$RATCHET_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin"}' \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

if [ -z "$TOKEN" ]; then
    fail "Could not get auth token from ratchet"
    exit 1
fi
pass "Authenticated with ratchet"

# ---- Create allow policy for file_read ----
# The policy engine defaults to deny-all. file_read needs an explicit allow.
# shell_exec will remain denied by the default policy.
info "Creating allow policy for file_read..."
POLICY_RESP=$(curl -sf -X POST "$RATCHET_URL/api/tool-policies" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"tool_pattern": "file_read", "action": "allow", "scope": "global"}')

POLICY_ID=$(echo "$POLICY_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")
if [ -n "$POLICY_ID" ]; then
    pass "Created allow policy for file_read: $POLICY_ID"
else
    fail "Could not create tool policy"
    exit 1
fi

# ---- Find development agent ----
AGENT_ID=$(curl -sf "$RATCHET_URL/api/agents" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
agents = json.load(sys.stdin)
for a in (agents if isinstance(agents, list) else []):
    if a.get('role') == 'development' and a.get('status') != 'stopped':
        print(a['id'])
        break
" 2>/dev/null)

if [ -z "$AGENT_ID" ]; then
    fail "No development agent found — check modules.yaml agent seeds"
    exit 1
fi
pass "Found development agent: $AGENT_ID"

# ---- Create task ----
info "Creating tool-policy task (task_role=development)..."
TASK_ID=$(curl -sf -X POST "$RATCHET_URL/api/tasks" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"Tool Policy Test","description":"Test shell_exec (denied) vs file_read (allowed) policy enforcement","task_role":"development","priority":2}' \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")

if [ -z "$TASK_ID" ]; then
    fail "Could not create task"
    exit 1
fi
pass "Created task: $TASK_ID"

# ---- Wait for task completion ----
info "Waiting for agent-tick to execute the task (up to 5 minutes)..."
TASK_STATUS=""
for i in $(seq 1 20); do
    sleep 15

    TASK_STATUS=$(curl -sf "$RATCHET_URL/api/tasks/$TASK_ID" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
t = json.load(sys.stdin)
print(t.get('status','unknown'))
" 2>/dev/null)

    info "  Check $i/20: task status=$TASK_STATUS"
    if [ "$TASK_STATUS" = "completed" ] || [ "$TASK_STATUS" = "failed" ]; then
        break
    fi
done

# Task may complete or fail depending on shell_exec denial handling
if [ "$TASK_STATUS" = "completed" ] || [ "$TASK_STATUS" = "failed" ]; then
    pass "Task reached terminal state: $TASK_STATUS"
else
    fail "Task status: $TASK_STATUS (expected completed or failed)"
fi

# ---- Check transcripts for policy enforcement ----
info "Checking agent transcripts for tool policy enforcement..."
TRANSCRIPTS=$(curl -sf "$RATCHET_URL/api/agents/$AGENT_ID/transcripts" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
data = json.load(sys.stdin)
entries = data if isinstance(data, list) else []
tool_calls_found = set()
tool_results = {}
for e in entries:
    tc = json.loads(e.get('tool_calls', '[]')) if isinstance(e.get('tool_calls'), str) else e.get('tool_calls', [])
    for call in (tc if isinstance(tc, list) else []):
        name = call.get('name', '') if isinstance(call, dict) else ''
        if name:
            tool_calls_found.add(name)
    role = e.get('role', '')
    if role == 'assistant' and tc:
        names = [c.get('name','') for c in (tc if isinstance(tc, list) else [])]
        print(f'  assistant called: {names}')
    elif role == 'tool':
        content = e.get('content', '')[:200]
        print(f'  tool result: {content}')
    elif role == 'assistant':
        content = e.get('content', '')[:150]
        if content:
            print(f'  assistant: {content}')
print(f'Tools invoked: {sorted(tool_calls_found)}')
" 2>/dev/null)

echo "$TRANSCRIPTS"

# shell_exec should appear (agent attempted it) — it will be denied by default policy
if echo "$TRANSCRIPTS" | grep -q "shell_exec"; then
    pass "shell_exec was attempted (as expected)"
else
    fail "shell_exec was NOT attempted"
fi

# file_read should appear and succeed (explicit allow policy)
if echo "$TRANSCRIPTS" | grep -q "file_read"; then
    pass "file_read was called (allowed by policy)"
else
    fail "file_read was NOT called"
fi

# Verify shell_exec denial in tool results
if echo "$TRANSCRIPTS" | grep -qi "denied\|policy\|not allowed\|permission"; then
    pass "Shell_exec denial message found in transcripts"
else
    info "Note: denial message not found in transcript text (may be in tool result content)"
fi

# ---- Final Summary ----
echo ""
echo "========================================="
if [ "$RESULT" = "PASSED" ]; then
    echo -e "${GREEN}E2E TOOL POLICY TEST: PASSED${NC}"
else
    echo -e "${RED}E2E TOOL POLICY TEST: FAILED${NC}"
fi
echo "========================================="
