#!/usr/bin/env bash
# E2E Browser QA Test
#
# Tests the browser automation tool chain: browser_navigate, browser_extract,
# and browser_screenshot against a local static HTML test page.
#
# What this does:
#   1. Checks for Chrome/Chromium (graceful skip if not available)
#   2. Builds ratchetd
#   3. Starts a python3 HTTP server on port 18888 serving testdata/
#   4. Starts ratchetd with browser-qa scenario
#   5. Authenticates and finds an active agent
#   6. Creates a browser QA task
#   7. Waits for the agent to complete the task
#   8. Verifies transcripts contain: browser_navigate → browser_extract →
#      browser_screenshot tool chain
#
# Usage:
#   ./scripts/e2e-browser.sh

set -euo pipefail

RATCHET_URL="${RATCHET_URL:-http://localhost:9090}"
HTTP_PORT=18888
DB_PATH="./data/ratchet-e2e-browser.db"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

RESULT="PASSED"
RATCHET_PID=""
HTTP_PID=""
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
    if [ -n "$HTTP_PID" ]; then
        info "Stopping HTTP server (PID $HTTP_PID)..."
        kill "$HTTP_PID" 2>/dev/null || true
        wait "$HTTP_PID" 2>/dev/null || true
        HTTP_PID=""
    fi
    rm -f "$TEMP_CONFIG" "$TEMP_TRIGGERS" "$DB_PATH" 2>/dev/null || true
}
trap cleanup EXIT

# ---- Check for Chrome ----
CHROME_BIN=""
for candidate in google-chrome chromium chromium-browser google-chrome-stable; do
    if command -v "$candidate" >/dev/null 2>&1; then
        CHROME_BIN="$candidate"
        break
    fi
done
# Also check macOS app paths
if [ -z "$CHROME_BIN" ]; then
    for candidate in \
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
        "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
        if [ -x "$candidate" ]; then
            CHROME_BIN="$candidate"
            break
        fi
    done
fi

if [ -z "$CHROME_BIN" ]; then
    echo -e "${YELLOW}[SKIP]${NC} Chrome/Chromium not found — skipping browser E2E test"
    echo "To run this test, install Google Chrome or Chromium."
    exit 0
fi
pass "Found Chrome: $CHROME_BIN"

# ---- Build ----
info "Building ratchetd..."
go build -o bin/ratchetd ./cmd/ratchetd/
pass "Build succeeded"

# ---- Start HTTP server for test page ----
info "Starting HTTP server on port $HTTP_PORT..."
python3 -m http.server "$HTTP_PORT" --directory . > /tmp/ratchet-e2e-browser-http.log 2>&1 &
HTTP_PID=$!
sleep 1

# Verify server is up
if curl -sf "http://localhost:$HTTP_PORT/testdata/test-page.html" > /dev/null; then
    pass "HTTP server serving test page"
else
    fail "HTTP server not responding on port $HTTP_PORT"
    exit 1
fi

# ---- Create fast-cron test config ----
TEMP_TRIGGERS=$(mktemp /tmp/triggers-e2e-browser-XXXX.yaml)
sed 's|\*/10 \* \* \* \*|* * * * *|g' config/triggers.yaml > "$TEMP_TRIGGERS"

TEMP_CONFIG=$(mktemp /tmp/ratchet-e2e-browser-XXXX.yaml)
sed "s|config/triggers.yaml|$TEMP_TRIGGERS|g" ratchet.yaml > "$TEMP_CONFIG"

# ---- Start server ----
info "Starting ratchetd with browser-qa scenario..."
mkdir -p "$(dirname "$DB_PATH")"
rm -f "$DB_PATH"

RATCHET_AI_PROVIDER=test \
RATCHET_AI_SCENARIO="testdata/scenarios/browser-qa.yaml" \
RATCHET_DB_PATH="$DB_PATH" \
./bin/ratchetd --config "$TEMP_CONFIG" > /tmp/ratchetd-e2e-browser.log 2>&1 &
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
info "Creating browser QA task..."
TASK_RESP=$(curl -sf -X POST "$RATCHET_URL/api/tasks" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"Browser QA Check\",\"description\":\"Navigate to http://localhost:${HTTP_PORT}/testdata/test-page.html and verify page content\"}")

TASK_ID=$(echo "$TASK_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
if [ -z "$TASK_ID" ]; then
    fail "Could not create task"
    exit 1
fi
pass "Created task: $TASK_ID"

# ---- Wait for task to complete ----
info "Waiting for browser QA task to complete (up to 5 minutes)..."
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
    pass "Browser QA task completed"
else
    fail "Browser QA task did not complete (status=$TASK_STATUS)"
fi

# ---- Check transcripts for browser tool chain ----
info "Checking transcripts for browser_navigate → browser_extract → browser_screenshot..."
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

if echo "$TRANSCRIPTS" | grep -q "browser_navigate"; then
    pass "browser_navigate was called"
else
    fail "browser_navigate was NOT called"
fi

if echo "$TRANSCRIPTS" | grep -q "browser_extract"; then
    pass "browser_extract was called"
else
    fail "browser_extract was NOT called"
fi

if echo "$TRANSCRIPTS" | grep -q "browser_screenshot"; then
    pass "browser_screenshot was called"
else
    fail "browser_screenshot was NOT called"
fi

# ---- Final Summary ----
echo ""
echo "========================================="
if [ "$RESULT" = "PASSED" ]; then
    echo -e "${GREEN}E2E BROWSER QA TEST: PASSED${NC}"
else
    echo -e "${RED}E2E BROWSER QA TEST: FAILED${NC}"
fi
echo "========================================="
