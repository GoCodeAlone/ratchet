#!/usr/bin/env bash
# E2E Sub-Agent Spawning Test
#
# Tests the agent delegation pattern: parent spawns an ephemeral sub-agent,
# calls agent_wait, continues, and completes.
#
# What this does:
#   1. Builds ratchetd
#   2. Starts server with sub-agent-parent scenario
#   3. Authenticates and finds an active agent
#   4. Creates a task
#   5. Waits for agent-tick to assign and execute the task
#   6. Verifies transcripts contain: agent_spawn → agent_wait → memory_save
#   7. Verifies a spawned ephemeral agent appears in /api/agents
#
# Note: the ephemeral sub-agent has status=busy and is not executed by
# agent-tick (which requires status=active). The E2E test verifies that
# the parent agent correctly spawns the sub-agent and proceeds through
# the delegation tool chain.
#
# Usage:
#   ./scripts/e2e-sub-agent.sh

set -euo pipefail

RATCHET_URL="${RATCHET_URL:-http://localhost:9090}"
DB_PATH="./data/ratchet-e2e-subagent.db"

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
TEMP_TRIGGERS=$(mktemp /tmp/triggers-e2e-subagent-XXXX.yaml)
sed 's|\*/10 \* \* \* \*|* * * * *|g' config/triggers.yaml > "$TEMP_TRIGGERS"

TEMP_CONFIG=$(mktemp /tmp/ratchet-e2e-subagent-XXXX.yaml)
sed "s|config/triggers.yaml|$TEMP_TRIGGERS|g" ratchet.yaml > "$TEMP_CONFIG"

# ---- Start server ----
info "Starting ratchetd with sub-agent-parent scenario..."
mkdir -p "$(dirname "$DB_PATH")"
rm -f "$DB_PATH"

RATCHET_AI_PROVIDER=test \
RATCHET_AI_SCENARIO="testdata/scenarios/sub-agent-parent.yaml" \
RATCHET_DB_PATH="$DB_PATH" \
./bin/ratchetd --config "$TEMP_CONFIG" > /tmp/ratchetd-e2e-subagent.log 2>&1 &
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

# ---- Find an active agent ----
AGENT_ID=$(curl -sf "$RATCHET_URL/api/agents" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
agents = json.load(sys.stdin)
for a in (agents if isinstance(agents, list) else []):
    if a.get('status') == 'active' and not a.get('is_ephemeral', False):
        print(a['id'])
        break
" 2>/dev/null)

if [ -z "$AGENT_ID" ]; then
    fail "No active (non-ephemeral) agent found — check modules.yaml agent seeds"
    exit 1
fi
pass "Found active agent: $AGENT_ID"

# ---- Create task ----
info "Creating task for sub-agent delegation test..."
TASK_RESP=$(curl -sf -X POST "$RATCHET_URL/api/tasks" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"Delegate File Analysis","description":"Analyze workspace files by delegating to a sub-agent"}')

TASK_ID=$(echo "$TASK_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
if [ -z "$TASK_ID" ]; then
    fail "Could not create task"
    exit 1
fi
pass "Created task: $TASK_ID"

# ---- Wait for agent to complete task (agent_wait has 5s timeout, so ~10-15s execution) ----
info "Waiting for parent task to complete (up to 5 minutes)..."
TASK_STATUS=""
ASSIGNED_TO=""
for i in $(seq 1 20); do
    sleep 15

    TASK_INFO=$(curl -sf "$RATCHET_URL/api/tasks/$TASK_ID" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
t = json.load(sys.stdin)
print(t.get('assigned_to','') + '|' + t.get('status','unknown'))
" 2>/dev/null)

    ASSIGNED_TO=$(echo "$TASK_INFO" | cut -d'|' -f1)
    TASK_STATUS=$(echo "$TASK_INFO" | cut -d'|' -f2)
    info "  Check $i/20: assigned_to=$ASSIGNED_TO status=$TASK_STATUS"

    if [ "$TASK_STATUS" = "completed" ] || [ "$TASK_STATUS" = "failed" ]; then
        break
    fi
done

if [ "$TASK_STATUS" = "completed" ]; then
    pass "Parent task completed"
else
    fail "Parent task did not complete (status=$TASK_STATUS)"
fi

# ---- Check transcripts for tool chain ----
info "Checking agent transcripts for agent_spawn → agent_wait → memory_save chain..."
TRANSCRIPTS=$(curl -sf "$RATCHET_URL/api/agents/$ASSIGNED_TO/transcripts" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
data = json.load(sys.stdin)
entries = data if isinstance(data, list) else []
tool_calls_found = set()
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
    elif role == 'assistant':
        content = e.get('content','')[:150]
        if content:
            print(f'  assistant: {content}')
print(f'Tools invoked: {sorted(tool_calls_found)}')
" 2>/dev/null)

echo "$TRANSCRIPTS"

if echo "$TRANSCRIPTS" | grep -q "agent_spawn"; then
    pass "agent_spawn was called"
else
    fail "agent_spawn was NOT called"
fi

if echo "$TRANSCRIPTS" | grep -q "agent_wait"; then
    pass "agent_wait was called"
else
    fail "agent_wait was NOT called"
fi

if echo "$TRANSCRIPTS" | grep -q "memory_save"; then
    pass "memory_save was called (parent continued after sub-agent delegation)"
else
    fail "memory_save was NOT called"
fi

# ---- Verify ephemeral sub-agent was created ----
info "Checking /api/agents for spawned ephemeral sub-agent..."
SUB_AGENT_COUNT=$(curl -sf "$RATCHET_URL/api/agents" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
agents = json.load(sys.stdin)
count = sum(1 for a in (agents if isinstance(agents, list) else []) if a.get('role') == 'sub-agent')
print(count)
" 2>/dev/null)

if [ "${SUB_AGENT_COUNT:-0}" -gt 0 ]; then
    pass "Found $SUB_AGENT_COUNT ephemeral sub-agent(s) in /api/agents"
else
    fail "No ephemeral sub-agent found in /api/agents"
fi

# ---- Final Summary ----
echo ""
echo "========================================="
if [ "$RESULT" = "PASSED" ]; then
    echo -e "${GREEN}E2E SUB-AGENT SPAWNING TEST: PASSED${NC}"
else
    echo -e "${RED}E2E SUB-AGENT SPAWNING TEST: FAILED${NC}"
fi
echo "========================================="
