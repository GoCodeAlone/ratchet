#!/usr/bin/env bash
# E2E Data Analysis Test
#
# Tests the data-monitor pipeline with the DataAnalyst agent.
#
# What this does:
#   1. Builds ratchetd
#   2. Starts server with data-analysis scripted scenario (test provider)
#   3. Authenticates and finds the DataAnalyst agent
#   4. Waits for data-monitor cron pipeline to fire and complete the task
#   5. Verifies tool call chain: db_health_check → db_analyze → memory_search → memory_save
#
# Usage:
#   ./scripts/e2e-data-analysis.sh

set -euo pipefail

RATCHET_URL="${RATCHET_URL:-http://localhost:9090}"
DB_PATH="./data/ratchet-e2e-data.db"

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

# ---- Create fast-cron test config (*/15 → * * * * *) ----
TEMP_TRIGGERS=$(mktemp /tmp/triggers-e2e-data-XXXX.yaml)
sed 's|\*/15 \* \* \* \*|* * * * *|g' config/triggers.yaml > "$TEMP_TRIGGERS"

TEMP_CONFIG=$(mktemp /tmp/ratchet-e2e-data-XXXX.yaml)
sed "s|config/triggers.yaml|$TEMP_TRIGGERS|g" ratchet.yaml > "$TEMP_CONFIG"

# ---- Start server ----
info "Starting ratchetd with data-analysis scenario..."
mkdir -p "$(dirname "$DB_PATH")"
rm -f "$DB_PATH"

RATCHET_AI_PROVIDER=test \
RATCHET_AI_SCENARIO=testdata/scenarios/data-analysis.yaml \
RATCHET_DB_PATH="$DB_PATH" \
./bin/ratchetd --config "$TEMP_CONFIG" > /tmp/ratchetd-e2e-data.log 2>&1 &
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

# ---- Find DataAnalyst agent ----
info "Looking for DataAnalyst agent (role=data)..."
AGENT_ID=$(curl -sf "$RATCHET_URL/api/agents" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
agents = json.load(sys.stdin)
for a in (agents if isinstance(agents, list) else []):
    if a.get('role') == 'data' and a.get('status') != 'stopped':
        print(a['id'])
        break
" 2>/dev/null)

if [ -z "$AGENT_ID" ]; then
    fail "No data agent found — check modules.yaml agent seeds"
    exit 1
fi
pass "Found DataAnalyst agent: $AGENT_ID"

# ---- Wait for data-monitor pipeline ----
info "Waiting for data-monitor cron pipeline to fire (up to 5 minutes)..."
info "Pipeline: find-data-agent → check-busy → create-analysis-task → execute-data-agent → mark-task-done"

TASK_FOUND=false
TASK_STATUS=""
TASK_ID=""
for i in $(seq 1 20); do
    sleep 15

    TASK_INFO=$(curl -sf "$RATCHET_URL/api/tasks" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
tasks = json.load(sys.stdin)
agent = '$AGENT_ID'
for t in (tasks if isinstance(tasks, list) else []):
    if t.get('title') == 'Database Health Check' and t.get('assigned_to') == agent:
        print(t.get('id','') + '|' + t.get('status','unknown'))
        break
" 2>/dev/null)

    if [ -n "$TASK_INFO" ]; then
        TASK_ID=$(echo "$TASK_INFO" | cut -d'|' -f1)
        TASK_STATUS=$(echo "$TASK_INFO" | cut -d'|' -f2)
        TASK_FOUND=true
        info "  Check $i/20: task=$TASK_ID status=$TASK_STATUS"
        if [ "$TASK_STATUS" = "completed" ] || [ "$TASK_STATUS" = "failed" ]; then
            break
        fi
    else
        info "  Check $i/20: no Database Health Check task yet"
    fi
done

if [ "$TASK_FOUND" = "false" ]; then
    fail "data-monitor pipeline did not create a Database Health Check task within 5 minutes"
    info "Check /tmp/ratchetd-e2e-data.log for errors"
    exit 1
fi

if [ "$TASK_STATUS" = "completed" ]; then
    pass "DataAnalyst completed the database health check task"
else
    fail "Task status: $TASK_STATUS"
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

echo "$TRANSCRIPTS" | grep -q "db_health_check" && pass "db_health_check was called" || fail "db_health_check was NOT called"
echo "$TRANSCRIPTS" | grep -q "db_analyze"      && pass "db_analyze was called"      || fail "db_analyze was NOT called"
echo "$TRANSCRIPTS" | grep -q "memory_search"   && pass "memory_search was called"   || fail "memory_search was NOT called"
echo "$TRANSCRIPTS" | grep -q "memory_save"     && pass "memory_save was called"     || fail "memory_save was NOT called"

# ---- Final Summary ----
echo ""
echo "========================================="
if [ "$RESULT" = "PASSED" ]; then
    echo -e "${GREEN}E2E DATA-ANALYSIS TEST: PASSED${NC}"
else
    echo -e "${RED}E2E DATA-ANALYSIS TEST: FAILED${NC}"
fi
echo "========================================="
