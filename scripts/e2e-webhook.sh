#!/usr/bin/env bash
# E2E Webhook-Triggered Task Test
#
# Tests the full webhook → task → agent execution pipeline.
# A GitHub push event creates a task which the agent picks up and
# executes (code_review → memory_save → completion).
#
# What this does:
#   1. Builds ratchetd
#   2. Starts server with the webhook-task scenario (scripted test provider)
#   3. Authenticates and creates a GitHub push webhook config
#   4. Sends a push payload to POST /api/webhooks/receive/github
#   5. Verifies a task was created from the webhook payload
#   6. Waits for agent-tick to assign and execute the task
#   7. Checks transcripts for code_review and memory_save
#
# Usage:
#   ./scripts/e2e-webhook.sh

set -euo pipefail

RATCHET_URL="${RATCHET_URL:-http://localhost:9090}"
DB_PATH="./data/ratchet-e2e-webhook.db"

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
TEMP_TRIGGERS=$(mktemp /tmp/triggers-e2e-webhook-XXXX.yaml)
sed 's|\*/10 \* \* \* \*|* * * * *|g' config/triggers.yaml > "$TEMP_TRIGGERS"

TEMP_CONFIG=$(mktemp /tmp/ratchet-e2e-webhook-XXXX.yaml)
sed "s|config/triggers.yaml|$TEMP_TRIGGERS|g" ratchet.yaml > "$TEMP_CONFIG"

# ---- Start server ----
info "Starting ratchetd with webhook-task scenario..."
mkdir -p "$(dirname "$DB_PATH")"
rm -f "$DB_PATH"

RATCHET_AI_PROVIDER=test \
RATCHET_AI_SCENARIO="testdata/scenarios/webhook-task.yaml" \
RATCHET_DB_PATH="$DB_PATH" \
./bin/ratchetd --config "$TEMP_CONFIG" > /tmp/ratchetd-e2e-webhook.log 2>&1 &
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

# ---- Create webhook config ----
info "Creating GitHub push webhook..."
WEBHOOK_RESP=$(curl -sf -X POST "$RATCHET_URL/api/webhooks" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "source": "github",
      "name": "GitHub Push Webhook",
      "filter": "push",
      "task_template": "title: GitHub Push Review\ndescription: Review code changes from GitHub push event"
    }')

WEBHOOK_ID=$(echo "$WEBHOOK_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")
if [ -z "$WEBHOOK_ID" ]; then
    fail "Could not create webhook"
    exit 1
fi
pass "Webhook created: $WEBHOOK_ID"

# ---- Send GitHub push event ----
info "Sending GitHub push payload to /api/webhooks/receive/github..."
WEBHOOK_RESULT=$(curl -sf -X POST "$RATCHET_URL/api/webhooks/receive/github" \
    -H "Content-Type: application/json" \
    -H "X-GitHub-Event: push" \
    -d '{
      "ref": "refs/heads/main",
      "repository": {"name": "ratchet", "full_name": "GoCodeAlone/ratchet"},
      "pusher": {"name": "developer"},
      "commits": [{"id": "abc123def456", "message": "Add new feature", "author": {"name": "developer"}}]
    }' | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('tasks_created', 0))
" 2>/dev/null)

if [ "$WEBHOOK_RESULT" = "1" ]; then
    pass "Webhook processed: 1 task created"
else
    fail "Webhook processing result: $WEBHOOK_RESULT (expected 1)"
fi

# ---- Verify task was created ----
info "Verifying webhook-created task in task list..."
TASK_ID=$(curl -sf "$RATCHET_URL/api/tasks" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
tasks = json.load(sys.stdin)
for t in (tasks if isinstance(tasks, list) else []):
    if 'GitHub Push Review' in t.get('title', ''):
        print(t['id'])
        break
" 2>/dev/null)

if [ -n "$TASK_ID" ]; then
    pass "Webhook task found: $TASK_ID"
else
    fail "Webhook-created task not found in task list"
    exit 1
fi

# ---- Wait for agent-tick to execute ----
info "Waiting for agent-tick to assign and execute the task (up to 5 minutes)..."
TASK_STATUS=""
ASSIGNED_AGENT=""
for i in $(seq 1 20); do
    sleep 15

    TASK_INFO=$(curl -sf "$RATCHET_URL/api/tasks/$TASK_ID" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
t = json.load(sys.stdin)
print(t.get('status','unknown') + '|' + (t.get('assigned_to') or ''))
" 2>/dev/null)

    TASK_STATUS=$(echo "$TASK_INFO" | cut -d'|' -f1)
    ASSIGNED_AGENT=$(echo "$TASK_INFO" | cut -d'|' -f2)

    info "  Check $i/20: status=$TASK_STATUS assigned_to=$ASSIGNED_AGENT"
    if [ "$TASK_STATUS" = "completed" ] || [ "$TASK_STATUS" = "failed" ]; then
        break
    fi
done

if [ "$TASK_STATUS" = "completed" ]; then
    pass "Task completed by agent $ASSIGNED_AGENT"
else
    fail "Task status: $TASK_STATUS (expected completed)"
fi

# ---- Check transcripts ----
if [ -z "$ASSIGNED_AGENT" ]; then
    fail "No agent was assigned to the task"
else
    info "Checking transcripts for agent $ASSIGNED_AGENT..."
    TRANSCRIPTS=$(curl -sf "$RATCHET_URL/api/agents/$ASSIGNED_AGENT/transcripts" -H "Authorization: Bearer $TOKEN" | python3 -c "
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

    if echo "$TRANSCRIPTS" | grep -q "code_review"; then
        pass "code_review was called"
    else
        fail "code_review was NOT called"
    fi

    if echo "$TRANSCRIPTS" | grep -q "memory_save"; then
        pass "memory_save was called (findings saved)"
    else
        fail "memory_save was NOT called"
    fi
fi

# ---- Final Summary ----
echo ""
echo "========================================="
if [ "$RESULT" = "PASSED" ]; then
    echo -e "${GREEN}E2E WEBHOOK TASK TEST: PASSED${NC}"
else
    echo -e "${RED}E2E WEBHOOK TASK TEST: FAILED${NC}"
fi
echo "========================================="
