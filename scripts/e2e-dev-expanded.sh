#!/usr/bin/env bash
# E2E Development Expanded Test
#
# Tests the development agent with expanded analysis tools: git stats and coverage.
#
# What this does:
#   1. Builds ratchetd
#   2. Starts server with dev-expanded scripted scenario (test provider)
#   3. Authenticates and finds the DevReview (development) agent
#   4. Activates the agent and creates a Code Review task
#   5. Waits for agent-tick to execute the task
#   6. Verifies tool call chain: code_review → git_log_stats → test_coverage →
#      code_complexity → memory_save
#
# Usage:
#   ./scripts/e2e-dev-expanded.sh

set -euo pipefail

RATCHET_URL="${RATCHET_URL:-http://localhost:9090}"
DB_PATH="./data/ratchet-e2e-dev-expanded.db"

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
TEMP_TRIGGERS=$(mktemp ./triggers-e2e-dev-expanded-XXXX.yaml)
cat > "$TEMP_TRIGGERS" <<'TRIGGERS'
triggers:
  schedule:
    jobs:
      - cron: "* * * * *"
        workflow: "pipeline:agent-tick"
        action: "tick"
TRIGGERS

TEMP_CONFIG=$(mktemp ./ratchet-e2e-dev-expanded-XXXX.yaml)
sed "s|config/triggers.yaml|$TEMP_TRIGGERS|g" ratchet.yaml > "$TEMP_CONFIG"

# ---- Start server ----
info "Starting ratchetd with dev-expanded scenario..."
mkdir -p "$(dirname "$DB_PATH")"
rm -f "$DB_PATH"

RATCHET_AI_PROVIDER=test \
RATCHET_AI_SCENARIO="testdata/scenarios/dev-expanded.yaml" \
RATCHET_DB_PATH="$DB_PATH" \
./bin/ratchetd --config "$TEMP_CONFIG" > /tmp/ratchetd-e2e-dev-expanded.log 2>&1 &
RATCHET_PID=$!
sleep 3

# ---- Authenticate ----
info "Authenticating..."
TOKEN=$(curl -sf -X POST "$RATCHET_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin"}' \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

if [ -z "$TOKEN" ]; then
    fail "Could not get auth token from ratchet"
    exit 1
fi
pass "Authenticated with ratchet"

# ---- Find development agent ----
info "Looking for DevReview agent (role=development)..."
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
pass "Found DevReview agent: $AGENT_ID"

# ---- Activate agent ----
info "Activating agent $AGENT_ID..."
ACTIVATE_RESP=$(curl -sf -X POST "$RATCHET_URL/api/agents/$AGENT_ID/start" \
    -H "Authorization: Bearer $TOKEN")
if echo "$ACTIVATE_RESP" | grep -q "active"; then
    pass "Agent activated"
else
    fail "Could not activate agent: $ACTIVATE_RESP"
    exit 1
fi

# ---- Create task ----
info "Creating Code Review task (task_role=development)..."
TASK_ID=$(curl -sf -X POST "$RATCHET_URL/api/tasks" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"Code Review","description":"Expanded code review with git stats and coverage","task_role":"development","priority":2}' \
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

if [ "$TASK_STATUS" = "completed" ]; then
    pass "DevReview completed the code review task"
else
    fail "Task status: $TASK_STATUS (expected completed)"
fi

# ---- Check transcripts ----
info "Checking agent transcripts for tool call chain..."
TRANSCRIPTS=$(curl -sf "$RATCHET_URL/api/agents/$AGENT_ID/transcripts" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
data = json.load(sys.stdin)
entries = data if isinstance(data, list) else []
tool_calls_found = set()
for e in entries:
    tc = json.loads(e.get('tool_calls','[]')) if isinstance(e.get('tool_calls'), str) else e.get('tool_calls',[])
    for call in (tc if isinstance(tc, list) else []):
        name = call.get('name','') if isinstance(call, dict) else ''
        if name:
            tool_calls_found.add(name)
    role = e.get('role','')
    if role == 'assistant' and tc:
        names = [c.get('name','') for c in (tc if isinstance(tc, list) else [])]
        print(f'  assistant called: {names}')
    elif role == 'tool':
        content = e.get('content','')[:100]
        print(f'  tool result: {content}')
print(f'Tools invoked: {sorted(tool_calls_found)}')
" 2>/dev/null)

echo "$TRANSCRIPTS"

echo "$TRANSCRIPTS" | grep -q "code_review"    && pass "code_review was called"    || fail "code_review was NOT called"
echo "$TRANSCRIPTS" | grep -q "git_log_stats"  && pass "git_log_stats was called"  || fail "git_log_stats was NOT called"
echo "$TRANSCRIPTS" | grep -q "test_coverage"  && pass "test_coverage was called"  || fail "test_coverage was NOT called"
echo "$TRANSCRIPTS" | grep -q "code_complexity" && pass "code_complexity was called" || fail "code_complexity was NOT called"
echo "$TRANSCRIPTS" | grep -q "memory_save"    && pass "memory_save was called"    || fail "memory_save was NOT called"

# ---- Final Summary ----
echo ""
echo "========================================="
if [ "$RESULT" = "PASSED" ]; then
    echo -e "${GREEN}E2E DEV-EXPANDED TEST: PASSED${NC}"
else
    echo -e "${RED}E2E DEV-EXPANDED TEST: FAILED${NC}"
    info "Check /tmp/ratchetd-e2e-dev-expanded.log for errors"
fi
echo "========================================="
