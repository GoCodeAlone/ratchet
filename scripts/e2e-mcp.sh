#!/usr/bin/env bash
# E2E MCP Server Test
#
# Tests the MCP server endpoint directly via JSON-RPC.
# The ratchet.mcp_server module is already configured in modules.yaml
# and wired to the router by mcpServerRouteHook (Task 2).
#
# This test does NOT use the scripted AI provider — it calls the MCP
# endpoint directly as an external MCP client would.
#
# What this does:
#   1. Builds ratchetd
#   2. Starts server (standard config — mock AI provider)
#   3. POSTs initialize to /mcp (MCP protocol handshake)
#   4. POSTs tools/list to /mcp — verifies ratchet tools are returned
#   5. POSTs tools/call ratchet_list_agents — verifies agent data returned
#   6. POSTs tools/call ratchet_list_tasks — verifies tasks endpoint works
#
# Usage:
#   ./scripts/e2e-mcp.sh

set -euo pipefail

RATCHET_URL="${RATCHET_URL:-http://localhost:9090}"
MCP_URL="${RATCHET_URL}/mcp"
DB_PATH="./data/ratchet-e2e-mcp.db"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

RESULT="PASSED"
RATCHET_PID=""

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
    rm -f "$DB_PATH" 2>/dev/null || true
}
trap cleanup EXIT

# ---- Build ----
info "Building ratchetd..."
go build -o bin/ratchetd ./cmd/ratchetd/
pass "Build succeeded"

# ---- Start server ----
info "Starting ratchetd..."
mkdir -p "$(dirname "$DB_PATH")"
rm -f "$DB_PATH"

RATCHET_DB_PATH="$DB_PATH" \
./bin/ratchetd --config ratchet.yaml > /tmp/ratchetd-e2e-mcp.log 2>&1 &
RATCHET_PID=$!
sleep 3

# ---- MCP Handshake: initialize ----
info "Step 1: MCP initialize handshake..."
INIT_RESP=$(curl -sf -X POST "$MCP_URL" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}},"id":1}')

PROTOCOL_VERSION=$(echo "$INIT_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = d.get('result', {})
print(r.get('protocolVersion', ''))
" 2>/dev/null)

if [ -n "$PROTOCOL_VERSION" ]; then
    pass "MCP initialize OK (protocolVersion=$PROTOCOL_VERSION)"
else
    fail "MCP initialize failed: $INIT_RESP"
    exit 1
fi

SERVER_NAME=$(echo "$INIT_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('result', {}).get('serverInfo', {}).get('name', ''))
" 2>/dev/null)
if [ "$SERVER_NAME" = "ratchet" ]; then
    pass "Server name is 'ratchet'"
else
    fail "Server name is '$SERVER_NAME' (expected 'ratchet')"
fi

# ---- tools/list ----
info "Step 2: tools/list..."
TOOLS_RESP=$(curl -sf -X POST "$MCP_URL" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"tools/list","id":2}')

TOOL_NAMES=$(echo "$TOOLS_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
tools = d.get('result', {}).get('tools', [])
names = [t.get('name','') for t in tools]
print(' '.join(names))
" 2>/dev/null)

info "Tools returned: $TOOL_NAMES"

if echo "$TOOL_NAMES" | grep -q "ratchet_list_agents"; then
    pass "ratchet_list_agents tool found"
else
    fail "ratchet_list_agents NOT in tools list"
fi

if echo "$TOOL_NAMES" | grep -q "ratchet_list_tasks"; then
    pass "ratchet_list_tasks tool found"
else
    fail "ratchet_list_tasks NOT in tools list"
fi

if echo "$TOOL_NAMES" | grep -q "ratchet_create_task"; then
    pass "ratchet_create_task tool found"
else
    fail "ratchet_create_task NOT in tools list"
fi

TOOL_COUNT=$(echo "$TOOL_NAMES" | wc -w | tr -d ' ')
info "Total tools: $TOOL_COUNT"
if [ "$TOOL_COUNT" -ge 5 ]; then
    pass "At least 5 MCP tools registered"
else
    fail "Only $TOOL_COUNT tools found (expected >= 5)"
fi

# ---- tools/call ratchet_list_agents ----
info "Step 3: tools/call ratchet_list_agents..."
AGENTS_RESP=$(curl -sf -X POST "$MCP_URL" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"ratchet_list_agents","arguments":{}},"id":3}')

# Response should have content with agent data
AGENT_CONTENT=$(echo "$AGENTS_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
result = d.get('result', {})
content = result.get('content', [])
if content and isinstance(content, list):
    text = content[0].get('text', '')
    agents = json.loads(text) if text else []
    print(len(agents))
else:
    print(0)
" 2>/dev/null)

if [ "$AGENT_CONTENT" -gt "0" ] 2>/dev/null; then
    pass "ratchet_list_agents returned $AGENT_CONTENT agents"
else
    fail "ratchet_list_agents returned no agents (or error): $AGENTS_RESP"
fi

# Verify no JSON-RPC error
JSONRPC_ERROR=$(echo "$AGENTS_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('error', {}).get('message', ''))
" 2>/dev/null)

if [ -z "$JSONRPC_ERROR" ]; then
    pass "No JSON-RPC error in response"
else
    fail "JSON-RPC error: $JSONRPC_ERROR"
fi

# ---- tools/call ratchet_list_tasks ----
info "Step 4: tools/call ratchet_list_tasks..."
TASKS_RESP=$(curl -sf -X POST "$MCP_URL" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"ratchet_list_tasks","arguments":{}},"id":4}')

TASKS_ERROR=$(echo "$TASKS_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('error', {}).get('message', ''))
" 2>/dev/null)

if [ -z "$TASKS_ERROR" ]; then
    pass "ratchet_list_tasks succeeded (no JSON-RPC error)"
else
    fail "ratchet_list_tasks error: $TASKS_ERROR"
fi

# ---- Final Summary ----
echo ""
echo "========================================="
if [ "$RESULT" = "PASSED" ]; then
    echo -e "${GREEN}E2E MCP SERVER TEST: PASSED${NC}"
else
    echo -e "${RED}E2E MCP SERVER TEST: FAILED${NC}"
fi
echo "========================================="
