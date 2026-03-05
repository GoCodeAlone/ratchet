#!/usr/bin/env bash
# E2E Operations Expanded Test
#
# Tests the infrastructure agent with expanded monitoring: deployment status
# and resource metrics via k8s_top. Gracefully skips if minikube is unavailable.
#
# What this does:
#   1. Checks for minikube availability — skips if not present
#   2. Builds ratchetd
#   3. Starts server with ops-expanded scripted scenario (test provider)
#   4. Authenticates and finds the InfraWatch (infrastructure) agent
#   5. Activates the agent and creates an Infrastructure Health Check task
#   6. Waits for agent-tick to execute the task
#   7. Verifies tool call chain: infra_health_check → deployment_status →
#      k8s_top (pods) → k8s_top (nodes) → memory_save
#
# Usage:
#   ./scripts/e2e-ops-expanded.sh

set -euo pipefail

RATCHET_URL="${RATCHET_URL:-http://localhost:9090}"
DB_PATH="./data/ratchet-e2e-ops-expanded.db"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

RESULT="PASSED"
RATCHET_PID=""
TEMP_CONFIG=""
TEMP_TRIGGERS=""

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; RESULT="FAILED"; }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }
skip() { echo -e "${BLUE}[SKIP]${NC} $1"; }

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

# ---- Check minikube availability ----
info "Checking minikube availability..."
if ! command -v minikube &>/dev/null; then
    skip "minikube not installed — skipping ops-expanded E2E test"
    echo ""
    echo "========================================="
    echo -e "${BLUE}E2E OPS-EXPANDED TEST: SKIPPED (no minikube)${NC}"
    echo "========================================="
    exit 0
fi
if ! minikube status &>/dev/null; then
    skip "minikube is not running — skipping ops-expanded E2E test"
    echo ""
    echo "========================================="
    echo -e "${BLUE}E2E OPS-EXPANDED TEST: SKIPPED (minikube not running)${NC}"
    echo "========================================="
    exit 0
fi
pass "minikube is running"

# ---- Build ----
info "Building ratchetd..."
go build -o bin/ratchetd ./cmd/ratchetd/
pass "Build succeeded"

# ---- Create fast-cron test config ----
TEMP_TRIGGERS=$(mktemp ./triggers-e2e-ops-expanded-XXXX.yaml)
cat > "$TEMP_TRIGGERS" <<'TRIGGERS'
triggers:
  schedule:
    jobs:
      - cron: "* * * * *"
        workflow: "pipeline:agent-tick"
        action: "tick"
TRIGGERS

TEMP_CONFIG=$(mktemp ./ratchet-e2e-ops-expanded-XXXX.yaml)
sed "s|config/triggers.yaml|$TEMP_TRIGGERS|g" ratchet.yaml > "$TEMP_CONFIG"

# ---- Start server ----
info "Starting ratchetd with ops-expanded scenario..."
mkdir -p "$(dirname "$DB_PATH")"
rm -f "$DB_PATH"

RATCHET_AI_PROVIDER=test \
RATCHET_AI_SCENARIO="testdata/scenarios/ops-expanded.yaml" \
RATCHET_DB_PATH="$DB_PATH" \
./bin/ratchetd --config "$TEMP_CONFIG" > /tmp/ratchetd-e2e-ops-expanded.log 2>&1 &
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

# ---- Find infrastructure agent ----
info "Looking for InfraWatch agent (role=infrastructure)..."
AGENT_ID=$(curl -sf "$RATCHET_URL/api/agents" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
agents = json.load(sys.stdin)
for a in (agents if isinstance(agents, list) else []):
    if a.get('role') == 'infrastructure' and a.get('status') != 'stopped':
        print(a['id'])
        break
" 2>/dev/null)

if [ -z "$AGENT_ID" ]; then
    fail "No infrastructure agent found — check modules.yaml agent seeds"
    exit 1
fi
pass "Found InfraWatch agent: $AGENT_ID"

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
info "Creating Infrastructure Health Check task (task_role=infrastructure)..."
TASK_ID=$(curl -sf -X POST "$RATCHET_URL/api/tasks" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"Infrastructure Health Check","description":"Expanded ops monitoring with deployment status and resource metrics","task_role":"infrastructure","priority":2}' \
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
    pass "InfraWatch completed the infrastructure health check task"
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

echo "$TRANSCRIPTS" | grep -q "infra_health_check"  && pass "infra_health_check was called"  || fail "infra_health_check was NOT called"
echo "$TRANSCRIPTS" | grep -q "deployment_status"   && pass "deployment_status was called"   || fail "deployment_status was NOT called"
echo "$TRANSCRIPTS" | grep -q "k8s_top"             && pass "k8s_top was called"             || fail "k8s_top was NOT called"
echo "$TRANSCRIPTS" | grep -q "memory_save"         && pass "memory_save was called"         || fail "memory_save was NOT called"

# ---- Final Summary ----
echo ""
echo "========================================="
if [ "$RESULT" = "PASSED" ]; then
    echo -e "${GREEN}E2E OPS-EXPANDED TEST: PASSED${NC}"
else
    echo -e "${RED}E2E OPS-EXPANDED TEST: FAILED${NC}"
    info "Check /tmp/ratchetd-e2e-ops-expanded.log for errors"
fi
echo "========================================="
