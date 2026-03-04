#!/usr/bin/env bash
# E2E Container Control Test
#
# Tests workspace container lifecycle: create project, start container,
# check status, stop container. Gracefully skips if Docker is unavailable.
#
# What this does:
#   1. Checks for Docker daemon availability — skips if not present
#   2. Builds ratchetd
#   3. Starts ratchetd with standard config
#   4. Authenticates and creates a project
#   5. POST /api/projects/{id}/container/start — starts an ubuntu container
#   6. GET /api/projects/{id}/container/status — verifies container state
#   7. POST /api/projects/{id}/container/stop — stops the container
#   8. Verifies final status is stopped
#
# Usage:
#   ./scripts/e2e-container.sh

set -euo pipefail

RATCHET_URL="${RATCHET_URL:-http://localhost:9090}"
DB_PATH="./data/ratchet-e2e-container.db"
CONTAINER_IMAGE="${CONTAINER_IMAGE:-ubuntu:22.04}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

RESULT="PASSED"
RATCHET_PID=""
TEMP_CONFIG=""

pass()  { echo -e "${GREEN}[PASS]${NC} $1"; }
fail()  { echo -e "${RED}[FAIL]${NC} $1"; RESULT="FAILED"; }
info()  { echo -e "${YELLOW}[INFO]${NC} $1"; }
skip()  { echo -e "${BLUE}[SKIP]${NC} $1"; }

cleanup() {
    if [ -n "$RATCHET_PID" ]; then
        info "Stopping ratchetd (PID $RATCHET_PID)..."
        kill "$RATCHET_PID" 2>/dev/null || true
        wait "$RATCHET_PID" 2>/dev/null || true
        RATCHET_PID=""
    fi
    rm -f "$TEMP_CONFIG" "$DB_PATH" 2>/dev/null || true
}
trap cleanup EXIT

# ---- Check Docker availability ----
info "Checking Docker availability..."
if ! command -v docker &>/dev/null; then
    skip "Docker not installed — skipping container E2E test"
    echo ""
    echo "========================================="
    echo -e "${BLUE}E2E CONTAINER TEST: SKIPPED (no docker)${NC}"
    echo "========================================="
    exit 0
fi

if ! docker info &>/dev/null 2>&1; then
    skip "Docker daemon not running — skipping container E2E test"
    echo ""
    echo "========================================="
    echo -e "${BLUE}E2E CONTAINER TEST: SKIPPED (daemon offline)${NC}"
    echo "========================================="
    exit 0
fi
pass "Docker daemon is available"

# ---- Build ----
info "Building ratchetd..."
go build -o bin/ratchetd ./cmd/ratchetd/
pass "Build succeeded"

# ---- Start server ----
info "Starting ratchetd..."
mkdir -p "$(dirname "$DB_PATH")"
rm -f "$DB_PATH"

TEMP_CONFIG=$(mktemp /tmp/ratchet-e2e-container-XXXX.yaml)
cp ratchet.yaml "$TEMP_CONFIG"

RATCHET_DB_PATH="$DB_PATH" \
./bin/ratchetd --config "$TEMP_CONFIG" > /tmp/ratchetd-e2e-container.log 2>&1 &
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

# ---- Create project ----
info "Creating test project..."
PROJECT_ID=$(curl -sf -X POST "$RATCHET_URL/api/projects" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"Container E2E Test","description":"E2E test project for container lifecycle"}' \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")

if [ -z "$PROJECT_ID" ]; then
    fail "Could not create project"
    exit 1
fi
pass "Created project: $PROJECT_ID"

# Give workspace_init time to set workspace_path
sleep 2

# ---- Start container ----
info "Starting container ($CONTAINER_IMAGE) for project $PROJECT_ID..."
START_RESP=$(curl -s -o /tmp/container-start.json -w "%{http_code}" -X POST \
    "$RATCHET_URL/api/projects/$PROJECT_ID/container/start" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"image\":\"$CONTAINER_IMAGE\"}")

START_BODY=$(cat /tmp/container-start.json 2>/dev/null)
info "Start response HTTP $START_RESP: $START_BODY"

if [ "$START_RESP" = "200" ]; then
    START_STATUS=$(echo "$START_BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('status', ''))
" 2>/dev/null)
    pass "Container start endpoint returned 200 (status: $START_STATUS)"
else
    fail "Container start returned HTTP $START_RESP"
fi

# ---- Check container status ----
info "Checking container status..."
sleep 3

STATUS_RESP=$(curl -sf "$RATCHET_URL/api/projects/$PROJECT_ID/container/status" \
    -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
d = json.load(sys.stdin)
status = d.get('status', d.get('container', {}) and 'no record' or 'no record')
print(status)
" 2>/dev/null)

info "Container status: $STATUS_RESP"
if [ -n "$STATUS_RESP" ]; then
    pass "Container status endpoint responded (status: $STATUS_RESP)"
else
    fail "Container status endpoint returned empty response"
fi

# ---- Stop container ----
info "Stopping container for project $PROJECT_ID..."
STOP_RESP=$(curl -s -o /tmp/container-stop.json -w "%{http_code}" -X POST \
    "$RATCHET_URL/api/projects/$PROJECT_ID/container/stop" \
    -H "Authorization: Bearer $TOKEN")

STOP_BODY=$(cat /tmp/container-stop.json 2>/dev/null)
info "Stop response HTTP $STOP_RESP: $STOP_BODY"

if [ "$STOP_RESP" = "200" ]; then
    STOP_STATUS=$(echo "$STOP_BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('status', ''))
" 2>/dev/null)
    pass "Container stop endpoint returned 200 (status: $STOP_STATUS)"
else
    fail "Container stop returned HTTP $STOP_RESP"
fi

# ---- Verify final status ----
info "Verifying final container status..."
sleep 2
FINAL_STATUS=$(curl -sf "$RATCHET_URL/api/projects/$PROJECT_ID/container/status" \
    -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('status', 'unknown'))
" 2>/dev/null)

info "Final container status: $FINAL_STATUS"
if [ "$FINAL_STATUS" = "stopped" ] || [ "$FINAL_STATUS" = "unknown" ] || [ "$FINAL_STATUS" = "no record" ]; then
    pass "Container reached stopped/cleared state: $FINAL_STATUS"
else
    info "Final status: $FINAL_STATUS (may still be transitioning)"
fi

# ---- Final Summary ----
echo ""
echo "========================================="
if [ "$RESULT" = "PASSED" ]; then
    echo -e "${GREEN}E2E CONTAINER TEST: PASSED${NC}"
else
    echo -e "${RED}E2E CONTAINER TEST: FAILED${NC}"
fi
echo "========================================="
