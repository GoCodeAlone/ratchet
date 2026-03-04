#!/usr/bin/env bash
# E2E Dev Review Learning Loop Test
#
# Tests the 3-run progressive learning loop for the development (DevReview) agent.
#
# What this does:
#   1. Builds ratchetd
#   2. Run 1 (Discovery): fresh DB, dev-review-run1 scenario — code_review, complexity, first memory_save
#   3. Run 2 (Recall):    KEEP DB, dev-review-run2 scenario — memory_search finds prior patterns
#   4. Run 3 (Decision):  KEEP DB, dev-review-run3 scenario — records DECISION to automate
#
# The learning loop works because runs 2+3 share the DB (and agent memory) from run 1.
#
# Usage:
#   ./scripts/e2e-dev-review.sh

set -euo pipefail

RATCHET_URL="${RATCHET_URL:-http://localhost:9090}"
DB_PATH="./data/ratchet-e2e-dev.db"

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

# ---- Create fast-cron test config (*/10 → * * * * *) ----
TEMP_TRIGGERS=$(mktemp /tmp/triggers-e2e-dev-XXXX.yaml)
sed 's|\*/10 \* \* \* \*|* * * * *|g' config/triggers.yaml > "$TEMP_TRIGGERS"

TEMP_CONFIG=$(mktemp /tmp/ratchet-e2e-dev-XXXX.yaml)
sed "s|config/triggers.yaml|$TEMP_TRIGGERS|g" ratchet.yaml > "$TEMP_CONFIG"

start_server() {
    local scenario="$1"
    if [ -n "$RATCHET_PID" ]; then
        info "Stopping current server (PID $RATCHET_PID)..."
        kill "$RATCHET_PID" 2>/dev/null || true
        wait "$RATCHET_PID" 2>/dev/null || true
        RATCHET_PID=""
        sleep 2
    fi
    info "Starting ratchetd with scenario: $scenario"
    RATCHET_AI_PROVIDER=test \
    RATCHET_AI_SCENARIO="$scenario" \
    RATCHET_DB_PATH="$DB_PATH" \
    ./bin/ratchetd --config "$TEMP_CONFIG" > /tmp/ratchetd-e2e-dev.log 2>&1 &
    RATCHET_PID=$!
    sleep 3
}

get_token() {
    curl -sf -X POST "$RATCHET_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d '{"username":"admin","password":"admin"}' \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))"
}

get_dev_agent_id() {
    local token="$1"
    curl -sf "$RATCHET_URL/api/agents" -H "Authorization: Bearer $token" | python3 -c "
import sys, json
agents = json.load(sys.stdin)
for a in (agents if isinstance(agents, list) else []):
    if a.get('role') == 'development' and a.get('status') != 'stopped':
        print(a['id'])
        break
" 2>/dev/null
}

# Wait for a "Code Review" task assigned to agent_id (excluding prev_task_id)
# Echos "task_id|status" on success, returns 1 on timeout
wait_for_task() {
    local token="$1"
    local agent_id="$2"
    local prev_task_id="${3:-}"

    for i in $(seq 1 20); do
        sleep 15

        local task_info
        task_info=$(curl -sf "$RATCHET_URL/api/tasks" -H "Authorization: Bearer $token" | python3 -c "
import sys, json
tasks = json.load(sys.stdin)
prev = '$prev_task_id'
agent = '$agent_id'
for t in (tasks if isinstance(tasks, list) else []):
    if t.get('title') == 'Code Review' and t.get('assigned_to') == agent and t.get('id') != prev:
        print(t.get('id','') + '|' + t.get('status','unknown'))
        break
" 2>/dev/null)

        if [ -n "$task_info" ]; then
            local task_id task_status
            task_id=$(echo "$task_info" | cut -d'|' -f1)
            task_status=$(echo "$task_info" | cut -d'|' -f2)
            info "  Check $i/20: task=$task_id status=$task_status"
            if [ "$task_status" = "completed" ] || [ "$task_status" = "failed" ]; then
                echo "$task_info"
                return 0
            fi
        else
            info "  Check $i/20: no Code Review task yet"
        fi
    done
    return 1
}

check_transcripts() {
    local token="$1"
    local agent_id="$2"
    curl -sf "$RATCHET_URL/api/agents/$agent_id/transcripts" -H "Authorization: Bearer $token" | python3 -c "
import sys, json
data = json.load(sys.stdin)
entries = data if isinstance(data, list) else []
tool_calls_found = set()
for e in entries:
    tc = json.loads(e.get('tool_calls', '[]')) if isinstance(e.get('tool_calls'), str) else e.get('tool_calls', [])
    for call in (tc if isinstance(tc, list) else []):
        name = call.get('name','') if isinstance(call, dict) else ''
        if name:
            tool_calls_found.add(name)
    role = e.get('role','')
    if role == 'assistant' and tc:
        names = [c.get('name','') for c in (tc if isinstance(tc, list) else [])]
        print(f'  assistant called: {names}')
    elif role == 'assistant':
        content = e.get('content','')[:150]
        if content:
            print(f'  assistant: {content}')
print(f'Tools invoked: {sorted(tool_calls_found)}')
" 2>/dev/null
}

# ==============================================================
# RUN 1: Discovery — fresh DB, initial code review
# ==============================================================
info "=== RUN 1: Discovery (fresh DB) ==="
mkdir -p "$(dirname "$DB_PATH")"
rm -f "$DB_PATH"

start_server "testdata/scenarios/dev-review-run1.yaml"

TOKEN=$(get_token)
[ -z "$TOKEN" ] && { fail "Could not authenticate"; exit 1; }
pass "Authenticated with ratchet"

AGENT_ID=$(get_dev_agent_id "$TOKEN")
[ -z "$AGENT_ID" ] && { fail "No development agent found — check modules.yaml agent seeds"; exit 1; }
pass "Found DevReview agent: $AGENT_ID"

info "Waiting for dev-review pipeline (up to 5 minutes)..."
TASK_INFO=$(wait_for_task "$TOKEN" "$AGENT_ID" "") || { fail "Run 1: Code Review task not found within timeout"; exit 1; }
TASK1_ID=$(echo "$TASK_INFO" | cut -d'|' -f1)
TASK1_STATUS=$(echo "$TASK_INFO" | cut -d'|' -f2)

if [ "$TASK1_STATUS" = "completed" ]; then
    pass "Run 1: Code Review task completed"
else
    fail "Run 1: Task status is $TASK1_STATUS"
fi

info "Run 1 Transcripts:"
TRANSCRIPTS1=$(check_transcripts "$TOKEN" "$AGENT_ID")
echo "$TRANSCRIPTS1"

echo "$TRANSCRIPTS1" | grep -q "code_review"   && pass "Run 1: code_review called"   || fail "Run 1: code_review NOT called"
echo "$TRANSCRIPTS1" | grep -q "code_complexity" && pass "Run 1: code_complexity called" || fail "Run 1: code_complexity NOT called"
echo "$TRANSCRIPTS1" | grep -q "memory_save"   && pass "Run 1: memory_save called"   || fail "Run 1: memory_save NOT called"

# ==============================================================
# RUN 2: Recall — KEEP DB, agent recalls past patterns
# ==============================================================
info "=== RUN 2: Recall (same DB) ==="

start_server "testdata/scenarios/dev-review-run2.yaml"

TOKEN=$(get_token)
AGENT_ID=$(get_dev_agent_id "$TOKEN")
pass "DevReview agent: $AGENT_ID"

info "Waiting for Run 2 Code Review task..."
TASK_INFO=$(wait_for_task "$TOKEN" "$AGENT_ID" "$TASK1_ID") || { fail "Run 2: Code Review task not found within timeout"; exit 1; }
TASK2_ID=$(echo "$TASK_INFO" | cut -d'|' -f1)
TASK2_STATUS=$(echo "$TASK_INFO" | cut -d'|' -f2)

[ "$TASK2_STATUS" = "completed" ] && pass "Run 2: Code Review task completed" || fail "Run 2: Task status is $TASK2_STATUS"

info "Run 2 Transcripts:"
TRANSCRIPTS2=$(check_transcripts "$TOKEN" "$AGENT_ID")
echo "$TRANSCRIPTS2"

echo "$TRANSCRIPTS2" | grep -q "memory_search"  && pass "Run 2: memory_search called (recalling patterns)" || fail "Run 2: memory_search NOT called"
echo "$TRANSCRIPTS2" | grep -qi "recurring"      && pass "Run 2: transcript references recurring pattern"  || fail "Run 2: 'recurring' not found in transcripts"

# ==============================================================
# RUN 3: Decision — KEEP DB, agent decides to automate
# ==============================================================
info "=== RUN 3: Decision (same DB) ==="

start_server "testdata/scenarios/dev-review-run3.yaml"

TOKEN=$(get_token)
AGENT_ID=$(get_dev_agent_id "$TOKEN")
pass "DevReview agent: $AGENT_ID"

info "Waiting for Run 3 Code Review task..."
TASK_INFO=$(wait_for_task "$TOKEN" "$AGENT_ID" "$TASK2_ID") || { fail "Run 3: Code Review task not found within timeout"; exit 1; }
TASK3_STATUS=$(echo "$TASK_INFO" | cut -d'|' -f2)

[ "$TASK3_STATUS" = "completed" ] && pass "Run 3: Code Review task completed" || fail "Run 3: Task status is $TASK3_STATUS"

info "Run 3 Transcripts:"
TRANSCRIPTS3=$(check_transcripts "$TOKEN" "$AGENT_ID")
echo "$TRANSCRIPTS3"

echo "$TRANSCRIPTS3" | grep -qi "decision"  && pass "Run 3: transcript contains 'decision' (learning loop complete)"  || fail "Run 3: 'decision' NOT found in transcripts"
echo "$TRANSCRIPTS3" | grep -qi "automate"  && pass "Run 3: transcript contains 'automate'"  || fail "Run 3: 'automate' NOT found in transcripts"

# ---- Final Summary ----
echo ""
echo "========================================="
if [ "$RESULT" = "PASSED" ]; then
    echo -e "${GREEN}E2E DEV-REVIEW TEST: PASSED${NC}"
else
    echo -e "${RED}E2E DEV-REVIEW TEST: FAILED${NC}"
fi
echo "========================================="
