#!/usr/bin/env bash
# E2E Team Coordination Test
#
# Tests role-based task assignment, inter-agent messaging, and skill assignment.
#
# What this does:
#   1. Builds ratchetd
#   2. Starts server with team-coordination scenario (developer agent scripted)
#      and RATCHET_SKILLS_DIR=testdata/skills to load the test skill
#   3. Authenticates and finds the developer agent (role=developer)
#   4. Lists skills via GET /api/skills and verifies test-skill loaded
#   5. Assigns test-skill to the developer agent via POST /api/agents/{id}/skills
#   6. Creates a task with task_role=developer
#   7. Waits for agent-tick to assign the task to the developer and execute it
#   8. Verifies transcripts contain: code_review → message_send tool chain
#   9. Verifies a message appears in /api/messages
#
# Usage:
#   ./scripts/e2e-team-coordination.sh

set -euo pipefail

RATCHET_URL="${RATCHET_URL:-http://localhost:9090}"
DB_PATH="./data/ratchet-e2e-team.db"

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
TEMP_TRIGGERS=$(mktemp ./triggers-e2e-team-XXXX.yaml)
cat > "$TEMP_TRIGGERS" <<'TRIGGERS'
triggers:
  schedule:
    jobs:
      - cron: "* * * * *"
        workflow: "pipeline:agent-tick"
        action: "tick"
TRIGGERS

TEMP_CONFIG=$(mktemp ./ratchet-e2e-team-XXXX.yaml)
sed "s|config/triggers.yaml|$TEMP_TRIGGERS|g" ratchet.yaml > "$TEMP_CONFIG"

# ---- Start server ----
info "Starting ratchetd with team-coordination scenario..."
mkdir -p "$(dirname "$DB_PATH")"
rm -f "$DB_PATH"

RATCHET_AI_PROVIDER=test \
RATCHET_AI_SCENARIO="testdata/scenarios/team-coordination.yaml" \
RATCHET_DB_PATH="$DB_PATH" \
RATCHET_SKILLS_DIR="testdata/skills" \
./bin/ratchetd --config "$TEMP_CONFIG" > /tmp/ratchetd-e2e-team.log 2>&1 &
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

# ---- Find developer agent ----
AGENT_ID=$(curl -sf "$RATCHET_URL/api/agents" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
agents = json.load(sys.stdin)
for a in (agents if isinstance(agents, list) else []):
    if a.get('role') == 'developer' and a.get('status') != 'stopped':
        print(a['id'])
        break
" 2>/dev/null)

if [ -z "$AGENT_ID" ]; then
    fail "No developer agent found — check modules.yaml agent seeds"
    exit 1
fi
pass "Found developer agent: $AGENT_ID"

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

# ---- Verify skill loaded and assign to developer agent ----
info "Listing skills via /api/skills..."
SKILL_ID=$(curl -sf "$RATCHET_URL/api/skills" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
skills = json.load(sys.stdin)
skills = skills if isinstance(skills, list) else []
for s in skills:
    if s.get('id') == 'test-skill':
        print(s['id'])
        break
" 2>/dev/null)

if [ -n "$SKILL_ID" ]; then
    pass "Found test-skill in /api/skills"
else
    fail "test-skill not found in /api/skills — check RATCHET_SKILLS_DIR loading"
    SKILL_ID="test-skill"  # continue anyway for partial test
fi

info "Assigning test-skill to developer agent..."
ASSIGN_RESP=$(curl -sf -X POST "$RATCHET_URL/api/agents/$AGENT_ID/skills" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"skill_id\":\"$SKILL_ID\"}")

ASSIGNED=$(echo "$ASSIGN_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('assigned', False))" 2>/dev/null)
if [ "$ASSIGNED" = "True" ] || [ "$ASSIGNED" = "true" ]; then
    pass "Skill $SKILL_ID assigned to developer agent"
else
    fail "Failed to assign skill: $ASSIGN_RESP"
fi

info "Verifying skill assignment via /api/agents/$AGENT_ID/skills..."
AGENT_SKILL=$(curl -sf "$RATCHET_URL/api/agents/$AGENT_ID/skills" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
skills = json.load(sys.stdin)
skills = skills if isinstance(skills, list) else []
for s in skills:
    if s.get('id') == 'test-skill':
        print(s['id'])
        break
" 2>/dev/null)

if [ "$AGENT_SKILL" = "test-skill" ]; then
    pass "Skill confirmed in /api/agents/$AGENT_ID/skills"
else
    fail "Skill not found in agent skills"
fi

# ---- Create task with task_role=developer ----
info "Creating task with task_role=developer..."
TASK_RESP=$(curl -sf -X POST "$RATCHET_URL/api/tasks" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"Team Coordination Review","description":"Review codebase and report findings to lead","task_role":"developer"}')

TASK_ID=$(echo "$TASK_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
if [ -z "$TASK_ID" ]; then
    fail "Could not create task"
    exit 1
fi
pass "Created task: $TASK_ID"

# ---- Wait for agent-tick to assign and execute the task ----
info "Waiting for agent-tick to assign and execute task (up to 5 minutes)..."
TASK_STATUS=""
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

# Verify task was assigned to the developer agent
if [ "$ASSIGNED_TO" = "$AGENT_ID" ]; then
    pass "Task assigned to developer agent (role-based assignment works)"
else
    fail "Task assigned to wrong agent: $ASSIGNED_TO (expected $AGENT_ID)"
fi

if [ "$TASK_STATUS" = "completed" ]; then
    pass "Task completed successfully"
elif [ "$TASK_STATUS" = "pending" ] || [ "$TASK_STATUS" = "in_progress" ]; then
    fail "Task did not complete within timeout (status=$TASK_STATUS)"
else
    fail "Task status: $TASK_STATUS"
fi

# ---- Check transcripts for tool call chain ----
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
        content = e.get('content','')[:150]
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

if echo "$TRANSCRIPTS" | grep -q "message_send"; then
    pass "message_send was called"
else
    fail "message_send was NOT called"
fi

# ---- Verify message in /api/messages ----
info "Verifying inter-agent message in /api/messages..."
MSG_COUNT=$(curl -sf "$RATCHET_URL/api/messages" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
msgs = json.load(sys.stdin)
msgs = msgs if isinstance(msgs, list) else []
count = sum(1 for m in msgs if m.get('from_agent') == '$AGENT_ID')
print(count)
" 2>/dev/null)

if [ "${MSG_COUNT:-0}" -gt 0 ]; then
    pass "Found $MSG_COUNT message(s) sent by developer agent"
else
    fail "No messages found from developer agent in /api/messages"
fi

# ---- Final Summary ----
echo ""
echo "========================================="
if [ "$RESULT" = "PASSED" ]; then
    echo -e "${GREEN}E2E TEAM COORDINATION TEST: PASSED${NC}"
else
    echo -e "${RED}E2E TEAM COORDINATION TEST: FAILED${NC}"
fi
echo "========================================="
