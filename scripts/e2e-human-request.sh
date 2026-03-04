#!/usr/bin/env bash
# E2E Human-in-the-Loop Test
#
# Tests the human request blocking flow: agent pauses for human input,
# human resolves the request, agent continues and completes.
#
# What this does:
#   1. Builds ratchetd
#   2. Starts server with human-request scenario (agent calls request_human blocking=true)
#   3. Authenticates and finds the lead agent
#   4. Creates a task
#   5. Waits for agent-tick to pick up task; agent calls request_human and blocks
#   6. Polls /api/requests for the pending human request
#   7. Resolves the request via POST /api/requests/{id}/resolve
#   8. Waits for the agent to continue and complete the task
#   9. Verifies transcripts contain: request_human → memory_save tool chain
#
# Usage:
#   ./scripts/e2e-human-request.sh

set -euo pipefail

RATCHET_URL="${RATCHET_URL:-http://localhost:9090}"
DB_PATH="./data/ratchet-e2e-human.db"

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
TEMP_TRIGGERS=$(mktemp /tmp/triggers-e2e-human-XXXX.yaml)
sed 's|\*/10 \* \* \* \*|* * * * *|g' config/triggers.yaml > "$TEMP_TRIGGERS"

TEMP_CONFIG=$(mktemp /tmp/ratchet-e2e-human-XXXX.yaml)
sed "s|config/triggers.yaml|$TEMP_TRIGGERS|g" ratchet.yaml > "$TEMP_CONFIG"

# ---- Start server ----
info "Starting ratchetd with human-request scenario..."
mkdir -p "$(dirname "$DB_PATH")"
rm -f "$DB_PATH"

RATCHET_AI_PROVIDER=test \
RATCHET_AI_SCENARIO="testdata/scenarios/human-request.yaml" \
RATCHET_DB_PATH="$DB_PATH" \
./bin/ratchetd --config "$TEMP_CONFIG" > /tmp/ratchetd-e2e-human.log 2>&1 &
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
    if a.get('status') == 'active':
        print(a['id'])
        break
" 2>/dev/null)

if [ -z "$AGENT_ID" ]; then
    fail "No active agent found — check modules.yaml agent seeds"
    exit 1
fi
pass "Found active agent: $AGENT_ID"

# ---- Create task ----
info "Creating task for human-in-the-loop test..."
TASK_RESP=$(curl -sf -X POST "$RATCHET_URL/api/tasks" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"Deploy to Environment","description":"Deploy application to target environment — requires operator confirmation of target"}')

TASK_ID=$(echo "$TASK_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
if [ -z "$TASK_ID" ]; then
    fail "Could not create task"
    exit 1
fi
pass "Created task: $TASK_ID"

# ---- Wait for agent to block on human request ----
info "Waiting for agent to submit human request (up to 2 minutes)..."
REQUEST_ID=""
for i in $(seq 1 8); do
    sleep 15

    REQUEST_ID=$(curl -sf "$RATCHET_URL/api/requests" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
reqs = json.load(sys.stdin)
reqs = reqs if isinstance(reqs, list) else []
for r in reqs:
    if r.get('status') == 'pending':
        print(r['id'])
        break
" 2>/dev/null)

    if [ -n "$REQUEST_ID" ]; then
        pass "Found pending human request: $REQUEST_ID"
        break
    fi
    info "  Check $i/8: no pending human request yet"
done

if [ -z "$REQUEST_ID" ]; then
    fail "No pending human request found within 2 minutes"
    exit 1
fi

# ---- Resolve the human request ----
info "Resolving human request $REQUEST_ID..."
RESOLVE_RESP=$(curl -sf -X POST "$RATCHET_URL/api/requests/$REQUEST_ID/resolve" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"response_data":"staging","response_comment":"Use staging environment for this deployment"}')

RESOLVED_STATUS=$(echo "$RESOLVE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null)
if [ "$RESOLVED_STATUS" = "resolved" ]; then
    pass "Human request resolved successfully"
else
    info "Resolve response: $RESOLVE_RESP"
    # Non-fatal: status field may vary; we'll verify by checking task completion
    info "Resolution submitted (status=$RESOLVED_STATUS)"
fi

# ---- Wait for agent to complete task after resolution ----
info "Waiting for agent to complete task after receiving human response (up to 3 minutes)..."
TASK_STATUS=""
ASSIGNED_TO=""
for i in $(seq 1 12); do
    sleep 15

    TASK_INFO=$(curl -sf "$RATCHET_URL/api/tasks/$TASK_ID" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
t = json.load(sys.stdin)
print(t.get('assigned_to','') + '|' + t.get('status','unknown'))
" 2>/dev/null)

    ASSIGNED_TO=$(echo "$TASK_INFO" | cut -d'|' -f1)
    TASK_STATUS=$(echo "$TASK_INFO" | cut -d'|' -f2)
    info "  Check $i/12: assigned_to=$ASSIGNED_TO status=$TASK_STATUS"

    if [ "$TASK_STATUS" = "completed" ] || [ "$TASK_STATUS" = "failed" ]; then
        break
    fi
done

if [ "$TASK_STATUS" = "completed" ]; then
    pass "Task completed after human response"
else
    fail "Task did not complete (status=$TASK_STATUS)"
fi

# ---- Check transcripts for tool call chain ----
info "Checking agent transcripts for request_human → memory_save chain..."
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

if echo "$TRANSCRIPTS" | grep -q "request_human"; then
    pass "request_human was called"
else
    fail "request_human was NOT called"
fi

if echo "$TRANSCRIPTS" | grep -q "memory_save"; then
    pass "memory_save was called (agent continued after human response)"
else
    fail "memory_save was NOT called"
fi

# ---- Verify the request is now resolved ----
info "Verifying human request status in /api/requests/all..."
REQ_STATUS=$(curl -sf "$RATCHET_URL/api/requests/all" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
reqs = json.load(sys.stdin)
reqs = reqs if isinstance(reqs, list) else []
for r in reqs:
    if r.get('id') == '$REQUEST_ID':
        print(r.get('status','unknown'))
        break
" 2>/dev/null)

if [ "$REQ_STATUS" = "resolved" ]; then
    pass "Human request status is resolved"
else
    info "Human request status: $REQ_STATUS (may vary by implementation)"
fi

# ---- Final Summary ----
echo ""
echo "========================================="
if [ "$RESULT" = "PASSED" ]; then
    echo -e "${GREEN}E2E HUMAN-IN-THE-LOOP TEST: PASSED${NC}"
else
    echo -e "${RED}E2E HUMAN-IN-THE-LOOP TEST: FAILED${NC}"
fi
echo "========================================="
