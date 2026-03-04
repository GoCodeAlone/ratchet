#!/usr/bin/env bash
# E2E Self-Healing Infrastructure Test
#
# Prerequisites:
#   - minikube running with kubectl configured
#   - ratchet server running locally with:
#     RATCHET_AI_PROVIDER=test RATCHET_AI_SCENARIO=testdata/scenarios/self-healing-rollback.yaml make dev
#   - Port 9090 accessible
#
# What this does:
#   1. Deploys a healthy nginx pod (revision 1)
#   2. Breaks it by updating to a nonexistent image (revision 2 = ImagePullBackOff)
#   3. Verifies the InfraWatch agent exists (seeded from modules.yaml)
#   4. Waits for the infra-monitor cron pipeline to fire (every minute) —
#      it creates a health check task and executes the scripted agent, which
#      calls infra_health_check → k8s_rollback → k8s_get_pods against real kubectl
#   5. Verifies the deployment was rolled back to the healthy revision
#   6. Checks agent transcripts for the expected tool call chain
#
# Usage:
#   ./scripts/e2e-self-healing.sh

set -euo pipefail

RATCHET_URL="${RATCHET_URL:-http://localhost:9090}"
DEPLOY_NAME="infra-test-app"
NAMESPACE="default"
GOOD_IMAGE="nginx:1.25"
BAD_IMAGE="nginx:does-not-exist-99999"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

RESULT="PASSED"

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; RESULT="FAILED"; }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

cleanup() {
    info "Cleaning up test deployment..."
    kubectl delete deployment "$DEPLOY_NAME" -n "$NAMESPACE" --ignore-not-found --grace-period=0 2>/dev/null || true
}

# ---- Step 1: Deploy healthy nginx ----
info "Step 1: Deploying healthy $DEPLOY_NAME with $GOOD_IMAGE"
cleanup

kubectl create deployment "$DEPLOY_NAME" \
    --image="$GOOD_IMAGE" \
    -n "$NAMESPACE" \
    --replicas=1

# Add app label for selector
kubectl label deployment "$DEPLOY_NAME" -n "$NAMESPACE" app="$DEPLOY_NAME" --overwrite 2>/dev/null || true

info "Waiting for deployment to be ready..."
if kubectl rollout status deployment/"$DEPLOY_NAME" -n "$NAMESPACE" --timeout=60s; then
    pass "Deployment $DEPLOY_NAME is healthy (revision 1)"
else
    fail "Deployment failed to become healthy"
    cleanup
    exit 1
fi

# Record revision 1
REV1=$(kubectl rollout history deployment/"$DEPLOY_NAME" -n "$NAMESPACE" | grep -E "^[0-9]" | tail -1 | awk '{print $1}')
info "Current revision: $REV1"

# ---- Step 2: Break it ----
info "Step 2: Breaking deployment with bad image $BAD_IMAGE"
kubectl set image deployment/"$DEPLOY_NAME" "*=$BAD_IMAGE" -n "$NAMESPACE"

info "Waiting for failure to manifest (30s)..."
sleep 30

# Verify it's broken
POD_STATUS=$(kubectl get pods -l app="$DEPLOY_NAME" -n "$NAMESPACE" -o jsonpath='{.items[*].status.containerStatuses[*].state.waiting.reason}' 2>/dev/null)
if echo "$POD_STATUS" | grep -qE "ImagePullBackOff|ErrImagePull|CrashLoopBackOff"; then
    pass "Deployment is broken: $POD_STATUS"
else
    info "Pod status: $POD_STATUS (may still be pulling)"
    PHASE=$(kubectl get pods -l app="$DEPLOY_NAME" -n "$NAMESPACE" -o jsonpath='{.items[*].status.phase}' 2>/dev/null)
    info "Pod phases: $PHASE"
fi

# ---- Step 3: Verify InfraWatch agent exists ----
info "Step 3: Verifying InfraWatch agent in ratchet"

TOKEN=$(curl -sf -X POST "$RATCHET_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

if [ -z "$TOKEN" ]; then
    fail "Could not get auth token from ratchet"
    cleanup
    exit 1
fi
pass "Authenticated with ratchet"

# Find the seeded infrastructure agent
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
    cleanup
    exit 1
fi
pass "Found InfraWatch agent: $AGENT_ID"

# ---- Step 4: Wait for infra-monitor pipeline to fire ----
info "Step 4: Waiting for infra-monitor cron pipeline (up to 3 minutes)..."
info "The pipeline will: create task → execute agent → infra_health_check → k8s_rollback → k8s_get_pods"

TASK_FOUND=false
TASK_STATUS=""
for i in $(seq 1 12); do
    sleep 15

    # Look for "Infrastructure Health Check" tasks created by infra-monitor
    TASK_INFO=$(curl -sf "$RATCHET_URL/api/tasks" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
tasks = json.load(sys.stdin)
for t in (tasks if isinstance(tasks, list) else []):
    if t.get('title') == 'Infrastructure Health Check' and t.get('assigned_to') == '$AGENT_ID':
        print(t.get('id', '') + '|' + t.get('status', 'unknown'))
        break
" 2>/dev/null)

    if [ -n "$TASK_INFO" ]; then
        TASK_ID=$(echo "$TASK_INFO" | cut -d'|' -f1)
        TASK_STATUS=$(echo "$TASK_INFO" | cut -d'|' -f2)
        TASK_FOUND=true
        info "  Check $i/12: found task $TASK_ID — status=$TASK_STATUS"

        if [ "$TASK_STATUS" = "completed" ] || [ "$TASK_STATUS" = "failed" ]; then
            break
        fi
    else
        info "  Check $i/12: no health check task yet (waiting for cron)"
    fi
done

if [ "$TASK_FOUND" = "false" ]; then
    fail "infra-monitor pipeline did not create a health check task within 3 minutes"
    info "Check ratchet logs — is the cron trigger firing?"
    cleanup
    exit 1
fi

if [ "$TASK_STATUS" = "completed" ]; then
    pass "Agent completed the self-healing task"
elif [ "$TASK_STATUS" = "pending" ]; then
    # Pipeline may still be executing — give it more time
    info "Task still pending, waiting 30 more seconds..."
    sleep 30
    TASK_STATUS=$(curl -sf "$RATCHET_URL/api/tasks" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
tasks = json.load(sys.stdin)
for t in (tasks if isinstance(tasks, list) else []):
    if t.get('id') == '$TASK_ID':
        print(t.get('status', 'unknown'))
        break
" 2>/dev/null)
    if [ "$TASK_STATUS" = "completed" ]; then
        pass "Agent completed the self-healing task"
    else
        info "Task status: $TASK_STATUS (pipeline may not have mark-task-done step)"
    fi
else
    fail "Task status: $TASK_STATUS"
fi

# ---- Step 5: Verify the deployment was actually rolled back ----
info "Step 5: Verifying deployment health after agent remediation"

# Wait a moment for rollback to stabilize
sleep 10

ROLLBACK_STATUS=$(kubectl rollout status deployment/"$DEPLOY_NAME" -n "$NAMESPACE" --timeout=60s 2>&1 && echo "OK" || echo "FAILED")
if echo "$ROLLBACK_STATUS" | grep -q "OK"; then
    pass "Deployment is healthy after rollback"
else
    fail "Deployment is still unhealthy: $ROLLBACK_STATUS"
fi

# Check current image
CURRENT_IMAGE=$(kubectl get deployment "$DEPLOY_NAME" -n "$NAMESPACE" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null)
info "Current image: $CURRENT_IMAGE"
if [ "$CURRENT_IMAGE" = "$GOOD_IMAGE" ]; then
    pass "Image rolled back to $GOOD_IMAGE"
elif [ "$CURRENT_IMAGE" = "$BAD_IMAGE" ]; then
    fail "Image is still the bad image $BAD_IMAGE"
else
    info "Image is $CURRENT_IMAGE (may be a different revision)"
fi

# Check pod status
POD_HEALTH=$(kubectl get pods -l app="$DEPLOY_NAME" -n "$NAMESPACE" -o jsonpath='{.items[*].status.phase}' 2>/dev/null)
if echo "$POD_HEALTH" | grep -q "Running"; then
    pass "Pod is Running"
else
    fail "Pod status: $POD_HEALTH"
fi

# ---- Step 6: Check transcripts ----
info "Step 6: Checking agent transcripts for tool call chain"
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
    if role == 'tool':
        content = e.get('content', '')[:100]
        print(f'  tool result: {content}')
    elif role == 'assistant' and tc:
        names = [c.get('name','') for c in (tc if isinstance(tc, list) else [])]
        print(f'  assistant called: {names}')
print(f'Tools invoked: {sorted(tool_calls_found)}')
" 2>/dev/null)

echo "$TRANSCRIPTS"

# Verify expected tools were called
if echo "$TRANSCRIPTS" | grep -q "infra_health_check"; then
    pass "infra_health_check was called"
else
    fail "infra_health_check was NOT called"
fi

if echo "$TRANSCRIPTS" | grep -q "k8s_rollback"; then
    pass "k8s_rollback was called"
else
    fail "k8s_rollback was NOT called"
fi

if echo "$TRANSCRIPTS" | grep -q "k8s_get_pods"; then
    pass "k8s_get_pods was called"
else
    fail "k8s_get_pods was NOT called"
fi

# ---- Cleanup ----
info "Cleaning up..."
cleanup

echo ""
echo "========================================="
if [ "$RESULT" = "PASSED" ]; then
    echo -e "${GREEN}E2E SELF-HEALING TEST: PASSED${NC}"
else
    echo -e "${RED}E2E SELF-HEALING TEST: FAILED${NC}"
fi
echo "========================================="
