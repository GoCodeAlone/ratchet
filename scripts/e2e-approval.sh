#!/usr/bin/env bash
# E2E Approval Flow Test
#
# Tests the human approval gate: an agent requests approval, the operator
# approves via the REST API, and the agent continues to completion.
#
# What this does:
#   1. Builds ratchetd
#   2. Starts server with the approval-flow scenario (scripted test provider)
#   3. Authenticates and finds the reviewer agent
#   4. Creates a task (task_role=reviewer) to trigger the agent
#   5. Waits for a pending approval to appear at GET /api/approvals
#   6. Approves it via POST /api/approvals/{id}/approve
#   7. Waits for the task to complete
#   8. Verifies transcripts contain request_approval and memory_save
#
# Usage:
#   ./scripts/e2e-approval.sh

set -euo pipefail

RATCHET_URL="${RATCHET_URL:-http://localhost:9090}"
DB_PATH="./data/ratchet-e2e-approval.db"

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
TEMP_TRIGGERS=$(mktemp ./triggers-e2e-approval-XXXX.yaml)
cat > "$TEMP_TRIGGERS" <<'TRIGGERS'
triggers:
  schedule:
    jobs:
      - cron: "* * * * *"
        workflow: "pipeline:agent-tick"
        action: "tick"
TRIGGERS

TEMP_CONFIG=$(mktemp ./ratchet-e2e-approval-XXXX.yaml)
sed "s|config/triggers.yaml|$TEMP_TRIGGERS|g" ratchet.yaml > "$TEMP_CONFIG"

# ---- Start server ----
info "Starting ratchetd with approval-flow scenario..."
mkdir -p "$(dirname "$DB_PATH")"
rm -f "$DB_PATH"

RATCHET_AI_PROVIDER=test \
RATCHET_AI_SCENARIO="testdata/scenarios/approval-flow.yaml" \
RATCHET_DB_PATH="$DB_PATH" \
./bin/ratchetd --config "$TEMP_CONFIG" > /tmp/ratchetd-e2e-approval.log 2>&1 &
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

# ---- Find reviewer agent ----
AGENT_ID=$(curl -sf "$RATCHET_URL/api/agents" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
agents = json.load(sys.stdin)
for a in (agents if isinstance(agents, list) else []):
    if a.get('role') == 'reviewer' and a.get('status') != 'stopped':
        print(a['id'])
        break
" 2>/dev/null)

if [ -z "$AGENT_ID" ]; then
    fail "No reviewer agent found — check modules.yaml agent seeds"
    exit 1
fi
pass "Found reviewer agent: $AGENT_ID"

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
info "Creating approval-flow task (task_role=reviewer)..."
TASK_ID=$(curl -sf -X POST "$RATCHET_URL/api/tasks" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"Approval Flow Test","description":"Test the human approval gate flow","task_role":"reviewer","priority":2}' \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")

if [ -z "$TASK_ID" ]; then
    fail "Could not create task"
    exit 1
fi
pass "Created task: $TASK_ID"

# ---- Wait for pending approval ----
info "Waiting for agent to call request_approval (up to 3 minutes)..."
APPROVAL_ID=""
for i in $(seq 1 12); do
    sleep 15

    APPROVAL_ID=$(curl -sf "$RATCHET_URL/api/approvals" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
approvals = json.load(sys.stdin)
for a in (approvals if isinstance(approvals, list) else []):
    if a.get('status') == 'pending':
        print(a['id'])
        break
" 2>/dev/null)

    if [ -n "$APPROVAL_ID" ]; then
        info "  Check $i/12: found pending approval $APPROVAL_ID"
        break
    else
        info "  Check $i/12: no pending approvals yet (waiting for agent-tick)"
    fi
done

if [ -z "$APPROVAL_ID" ]; then
    fail "No pending approval appeared within 3 minutes"
    info "Check /tmp/ratchetd-e2e-approval.log for server logs"
    exit 1
fi
pass "Pending approval found: $APPROVAL_ID"

# ---- Approve it ----
info "Approving via POST /api/approvals/$APPROVAL_ID/approve..."
APPROVE_RESP=$(curl -sf -X POST "$RATCHET_URL/api/approvals/$APPROVAL_ID/approve" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"comment":"LGTM — deployment approved for production"}' \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','') or 'ok')" 2>/dev/null)
pass "Approval submitted (response: $APPROVE_RESP)"

# ---- Wait for task completion ----
info "Waiting for task to complete after approval (up to 3 minutes)..."
TASK_STATUS=""
for i in $(seq 1 12); do
    sleep 15

    TASK_STATUS=$(curl -sf "$RATCHET_URL/api/tasks/$TASK_ID" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
t = json.load(sys.stdin)
print(t.get('status','unknown'))
" 2>/dev/null)

    info "  Check $i/12: task status=$TASK_STATUS"
    if [ "$TASK_STATUS" = "completed" ] || [ "$TASK_STATUS" = "failed" ]; then
        break
    fi
done

if [ "$TASK_STATUS" = "completed" ]; then
    pass "Task completed after approval"
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
        content = e.get('content', '')[:150]
        if content:
            print(f'  assistant: {content}')
print(f'Tools invoked: {sorted(tool_calls_found)}')
" 2>/dev/null)

echo "$TRANSCRIPTS"

if echo "$TRANSCRIPTS" | grep -q "request_approval"; then
    pass "request_approval was called"
else
    fail "request_approval was NOT called"
fi

if echo "$TRANSCRIPTS" | grep -q "memory_save"; then
    pass "memory_save was called (approval outcome saved)"
else
    fail "memory_save was NOT called"
fi

# ---- Final Summary ----
echo ""
echo "========================================="
if [ "$RESULT" = "PASSED" ]; then
    echo -e "${GREEN}E2E APPROVAL FLOW TEST: PASSED${NC}"
else
    echo -e "${RED}E2E APPROVAL FLOW TEST: FAILED${NC}"
fi
echo "========================================="
