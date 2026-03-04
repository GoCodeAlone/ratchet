# Ratchet Complete E2E Coverage — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close all E2E coverage gaps in Ratchet — fix role-based task routing, wire MCP server route, and add 9 new E2E test scripts covering team coordination, human-in-the-loop, approval flow, sub-agent spawning, webhooks, browser QA, tool policies, container control, and MCP integration.

**Architecture:** Each E2E test is a self-contained bash script that starts ratchetd with a scripted test provider scenario, exercises a specific feature via API calls, and verifies the expected tool chain completed. Code fixes are minimal — one SQL change for role-based routing, one wiring hook for MCP.

**Tech Stack:** Go 1.26, SQLite, bash E2E scripts, YAML scripted scenarios, curl + python3 for API verification.

---

### Task 1: Add `task_role` Column and Role-Based Assignment

**Files:**
- Modify: `ratchetplugin/db.go:28-48` (tasks schema)
- Modify: `config/pipelines.yaml:23-34` (auto-assign-tasks step)
- Modify: `config/routes-tasks.yaml:55-69` (task creation INSERT)

**Step 1: Add `task_role` column to tasks table schema**

In `ratchetplugin/db.go`, find the `CREATE TABLE IF NOT EXISTS tasks` block (around line 28). Add `task_role TEXT NOT NULL DEFAULT ''` after the `error` column:

```sql
    error TEXT NOT NULL DEFAULT '',
    task_role TEXT NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT (datetime('now')),
```

Also add a migration in the `applyMigrations` function (around line 241) for existing databases:

```go
{Version: 2, SQL: "ALTER TABLE tasks ADD COLUMN task_role TEXT NOT NULL DEFAULT ''"},
```

**Step 2: Update auto-assign-tasks to filter by role**

In `config/pipelines.yaml`, replace the `auto-assign-tasks` step query (lines 23-34) with:

```yaml
    - name: auto-assign-tasks
      type: step.db_exec
      config:
        database: ratchet-db
        query: >
          UPDATE tasks SET assigned_to = (
            SELECT a.id FROM agents a WHERE a.status = 'active'
            AND a.id NOT IN (SELECT assigned_to FROM tasks WHERE status = 'in_progress' AND assigned_to != '')
            AND (tasks.task_role = '' OR a.role = tasks.task_role)
            ORDER BY RANDOM() LIMIT 1
          ), updated_at = datetime('now')
          WHERE status = 'pending' AND (assigned_to = '' OR assigned_to IS NULL)
          AND EXISTS (SELECT 1 FROM agents WHERE status = 'active')
```

The key change is `AND (tasks.task_role = '' OR a.role = tasks.task_role)` — empty task_role matches any agent, non-empty matches only agents with that role.

**Step 3: Add task_role to task creation route**

In `config/routes-tasks.yaml`, update the INSERT query (around line 55) to include `task_role`:

```yaml
    query: "INSERT INTO tasks (id, title, description, status, priority, assigned_to, team_id, project_id, parent_id, task_role, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, '', ?, ?, ?)"
    params:
      - "{{ .steps.prepare.id }}"
      - "{{ step \"parse-request\" \"body\" \"title\" }}"
      - "{{ default \"\" (step \"parse-request\" \"body\" \"description\") }}"
      - "{{ default 1 (step \"parse-request\" \"body\" \"priority\") }}"
      - "{{ default \"\" (step \"parse-request\" \"body\" \"assigned_to\") }}"
      - "{{ default \"\" (step \"parse-request\" \"body\" \"team_id\") }}"
      - "{{ default \"\" (step \"parse-request\" \"body\" \"project_id\") }}"
      - "{{ default \"\" (step \"parse-request\" \"body\" \"task_role\") }}"
      - "{{ .steps.prepare.now }}"
      - "{{ .steps.prepare.now }}"
```

**Step 4: Verify existing tests still pass**

Run: `go test -race ./ratchetplugin/... -count=1`
Expected: PASS (schema change is additive)

**Step 5: Commit**

```bash
git add ratchetplugin/db.go config/pipelines.yaml config/routes-tasks.yaml
git commit -m "feat: add role-based task routing via task_role column"
```

---

### Task 2: Wire MCP Server Route

**Files:**
- Modify: `ratchetplugin/plugin.go:97-118` (add hook to WiringHooks list)
- Create: `ratchetplugin/hook_mcp_server_route.go`

**Step 1: Create the MCP server route wiring hook**

Create `ratchetplugin/hook_mcp_server_route.go`:

```go
package ratchetplugin

import (
	"log"
	"net/http"

	"github.com/CrisisTextLine/modular"
	"github.com/GoCodeAlone/workflow/module"
	"github.com/GoCodeAlone/workflow/plugin"
)

func mcpServerRouteHook() plugin.WiringHook {
	return plugin.WiringHook{
		Name:     "ratchet.mcp_server_route",
		Priority: 45,
		Hook: func(app modular.Application, cfg *module.WorkflowConfig) error {
			svc, ok := app.SvcRegistry()["ratchet-mcp-server"]
			if !ok {
				return nil // MCP server not configured, skip
			}
			mcpServer, ok := svc.(*MCPServerModule)
			if !ok {
				return nil
			}

			// Find the router to register the MCP endpoint
			for _, s := range app.SvcRegistry() {
				if router, ok := s.(interface {
					AddRoute(path string, method string, handler http.Handler)
				}); ok {
					path := mcpServer.Path()
					router.AddRoute(path, "POST", mcpServer)
					log.Printf("[ratchet] MCP server route registered at POST %s", path)
					return nil
				}
			}
			return nil
		},
	}
}
```

**Step 2: Register the hook in plugin.go**

In `ratchetplugin/plugin.go`, add `mcpServerRouteHook()` to the `WiringHooks()` return slice (around line 117, before the closing `}`):

```go
        browserManagerHook(),
        testInteractionHook(),
        mcpServerRouteHook(),
    }
```

**Step 3: Check that the router AddRoute interface matches**

Read the workflow engine's router module to verify it has an `AddRoute(path, method, handler)` method. If it uses a different method signature (e.g., `Handle` or `HandleFunc`), adapt. The SSE route registration hook (`sseRouteRegistrationHook`) already does this — follow the same pattern it uses.

**Step 4: Build and test**

Run: `go build ./... && go test -race ./ratchetplugin/... -count=1`
Expected: PASS

**Step 5: Commit**

```bash
git add ratchetplugin/hook_mcp_server_route.go ratchetplugin/plugin.go
git commit -m "feat: wire MCP server HTTP route via wiring hook"
```

---

### Task 3: Team Coordination Scenario + E2E Script

**Files:**
- Create: `testdata/scenarios/team-coordination.yaml`
- Create: `scripts/e2e-team-coordination.sh`

**Step 1: Create the scripted scenario**

Create `testdata/scenarios/team-coordination.yaml`:

```yaml
name: team-coordination
loop: false
description: >
  Developer agent receives a role-targeted task, performs code review,
  and sends a message to notify the reviewer agent.

steps:
  # Turn 1: code_review
  - content: "I'll start by reviewing the codebase for quality issues."
    tool_calls:
      - name: code_review
        arguments:
          path: "."

  # Turn 2: message_send to notify reviewer
  - content: "Code review complete. Notifying the reviewer about findings."
    tool_calls:
      - name: message_send
        arguments:
          to: "reviewer"
          content: "Code review completed for task. Found 0 critical issues. Ready for final review."

  # Turn 3: completion — no tool_calls exits agent loop
  - content: "Task complete. Code review performed and reviewer notified via message."
```

**Step 2: Create the E2E script**

Create `scripts/e2e-team-coordination.sh`:

```bash
#!/usr/bin/env bash
# E2E Team Coordination Test
#
# Tests role-based task routing in the agent-tick pipeline.
#
# What this does:
#   1. Builds ratchetd
#   2. Starts server with team-coordination scripted scenario
#   3. Creates a task with task_role=developer via API
#   4. Waits for agent-tick to assign it to the Developer agent (not orchestrator)
#   5. Verifies tool call chain: code_review → message_send
#   6. Verifies message appears in /api/messages
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
TEMP_TRIGGERS=$(mktemp /tmp/triggers-e2e-team-XXXX.yaml)
sed 's|\* \* \* \* \*|* * * * *|g' config/triggers.yaml > "$TEMP_TRIGGERS"

TEMP_CONFIG=$(mktemp /tmp/ratchet-e2e-team-XXXX.yaml)
sed "s|config/triggers.yaml|$TEMP_TRIGGERS|g" ratchet.yaml > "$TEMP_CONFIG"

# ---- Start server ----
info "Starting ratchetd with team-coordination scenario..."
mkdir -p "$(dirname "$DB_PATH")"
rm -f "$DB_PATH"

RATCHET_AI_PROVIDER=test \
RATCHET_AI_SCENARIO=testdata/scenarios/team-coordination.yaml \
RATCHET_DB_PATH="$DB_PATH" \
./bin/ratchetd --config "$TEMP_CONFIG" > /tmp/ratchetd-e2e-team.log 2>&1 &
RATCHET_PID=$!
sleep 3

# ---- Authenticate ----
info "Authenticating..."
TOKEN=$(curl -sf -X POST "$RATCHET_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin"}' \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

if [ -z "$TOKEN" ]; then
    fail "Could not get auth token"
    exit 1
fi
pass "Authenticated"

# ---- Find Developer agent ----
info "Looking for Developer agent (role=developer)..."
DEVELOPER_ID=$(curl -sf "$RATCHET_URL/api/agents" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
agents = json.load(sys.stdin)
for a in (agents if isinstance(agents, list) else []):
    if a.get('role') == 'developer' and a.get('status') != 'stopped':
        print(a['id'])
        break
" 2>/dev/null)

if [ -z "$DEVELOPER_ID" ]; then
    fail "No developer agent found"
    exit 1
fi
pass "Found Developer agent: $DEVELOPER_ID"

# ---- Create task with task_role=developer ----
info "Creating task with task_role=developer..."
TASK_CREATE=$(curl -sf -X POST "$RATCHET_URL/api/tasks" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"title":"Team Code Review","description":"Review codebase quality and notify reviewer","priority":5,"task_role":"developer"}')

info "Task creation response: $TASK_CREATE"

# ---- Wait for agent-tick to assign and execute ----
info "Waiting for agent-tick to assign task to Developer and execute (up to 5 minutes)..."

TASK_FOUND=false
TASK_STATUS=""
TASK_ID=""
for i in $(seq 1 20); do
    sleep 15

    TASK_INFO=$(curl -sf "$RATCHET_URL/api/tasks" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
tasks = json.load(sys.stdin)
dev = '$DEVELOPER_ID'
for t in (tasks if isinstance(tasks, list) else []):
    if t.get('title') == 'Team Code Review' and t.get('assigned_to') == dev:
        print(t.get('id','') + '|' + t.get('status','unknown'))
        break
" 2>/dev/null)

    if [ -n "$TASK_INFO" ]; then
        TASK_ID=$(echo "$TASK_INFO" | cut -d'|' -f1)
        TASK_STATUS=$(echo "$TASK_INFO" | cut -d'|' -f2)
        TASK_FOUND=true
        info "  Check $i/20: task=$TASK_ID status=$TASK_STATUS assigned_to=developer"
        if [ "$TASK_STATUS" = "completed" ] || [ "$TASK_STATUS" = "failed" ]; then
            break
        fi
    else
        info "  Check $i/20: task not yet assigned to developer"
    fi
done

if [ "$TASK_FOUND" = "false" ]; then
    fail "agent-tick did not assign task to Developer agent within 5 minutes"
    info "Check /tmp/ratchetd-e2e-team.log for errors"
    exit 1
fi

if [ "$TASK_STATUS" = "completed" ]; then
    pass "Developer agent completed the team code review task"
else
    fail "Task status: $TASK_STATUS"
fi

# ---- Verify role-based assignment ----
info "Verifying task was NOT assigned to orchestrator..."
ORCHESTRATOR_TASK=$(curl -sf "$RATCHET_URL/api/tasks" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
tasks = json.load(sys.stdin)
for t in (tasks if isinstance(tasks, list) else []):
    if t.get('title') == 'Team Code Review' and t.get('assigned_to') == 'orchestrator':
        print('found')
        break
" 2>/dev/null)
[ -z "$ORCHESTRATOR_TASK" ] && pass "Task correctly NOT assigned to orchestrator" || fail "Task was assigned to orchestrator"

# ---- Check transcripts for tool chain ----
info "Checking agent transcripts for tool call chain..."
TRANSCRIPTS=$(curl -sf "$RATCHET_URL/api/agents/$DEVELOPER_ID/transcripts" -H "Authorization: Bearer $TOKEN" | python3 -c "
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
print(f'Tools invoked: {sorted(tool_calls_found)}')
" 2>/dev/null)

echo "$TRANSCRIPTS"

echo "$TRANSCRIPTS" | grep -q "code_review"   && pass "code_review was called"   || fail "code_review was NOT called"
echo "$TRANSCRIPTS" | grep -q "message_send"   && pass "message_send was called"  || fail "message_send was NOT called"

# ---- Check messages API ----
info "Checking /api/messages for reviewer notification..."
MESSAGES=$(curl -sf "$RATCHET_URL/api/messages" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
data = json.load(sys.stdin)
msgs = data if isinstance(data, list) else []
for m in msgs:
    if 'reviewer' in str(m.get('to','')).lower() or 'reviewer' in str(m.get('content','')).lower():
        print('found')
        break
" 2>/dev/null)
[ "$MESSAGES" = "found" ] && pass "Message to reviewer found" || fail "No message to reviewer found"

# ---- Final Summary ----
echo ""
echo "========================================="
if [ "$RESULT" = "PASSED" ]; then
    echo -e "${GREEN}E2E TEAM-COORDINATION TEST: PASSED${NC}"
else
    echo -e "${RED}E2E TEAM-COORDINATION TEST: FAILED${NC}"
fi
echo "========================================="
```

Make it executable: `chmod +x scripts/e2e-team-coordination.sh`

**Step 3: Commit**

```bash
git add testdata/scenarios/team-coordination.yaml scripts/e2e-team-coordination.sh
git commit -m "feat: add team coordination E2E test with role-based routing"
```

---

### Task 4: Human-in-the-Loop Scenario + E2E Script

**Files:**
- Create: `testdata/scenarios/human-request.yaml`
- Create: `scripts/e2e-human-request.sh`

**Step 1: Create the scripted scenario**

Create `testdata/scenarios/human-request.yaml`:

```yaml
name: human-request
loop: false
description: >
  Agent encounters a situation requiring human input. Calls request_human
  with blocking=true, waits for resolution, then continues with memory_save.

steps:
  # Turn 1: request_human with blocking
  - content: "I need human input before proceeding with this deployment decision."
    tool_calls:
      - name: request_human
        arguments:
          request_type: "info"
          title: "Deployment Approval Needed"
          description: "The staging environment has 3 failing health checks. Should I proceed with production deployment or investigate first?"
          urgency: "high"
          blocking: true

  # Turn 2: After human resolves — save the decision to memory
  - content: "Human responded. Saving the decision to memory for future reference."
    tool_calls:
      - name: memory_save
        arguments:
          content: "Human decided to investigate staging failures before production deployment. Decision logged for future reference."
          tags: "deployment,human-decision"

  # Turn 3: completion
  - content: "Task complete. Human input received and logged. Will investigate staging before deploying to production."
```

**Step 2: Create the E2E script**

Create `scripts/e2e-human-request.sh` following the same pattern as other E2E scripts. Key differences:

1. Start server with `RATCHET_AI_SCENARIO=testdata/scenarios/human-request.yaml`
2. Find an agent (use `infrawatch` or any active agent)
3. Create a task assigned to that agent
4. Wait for the agent to call `request_human` — poll `GET /api/requests` until a pending request appears
5. Resolve via `POST /api/requests/{id}/resolve` with `{"response_data":"Investigate staging first","response_comment":"Do not deploy until staging is green"}`
6. Wait for agent to continue and complete the task
7. Verify tool chain: `request_human` → `memory_save`

The script must handle the blocking wait: the agent will be stuck inside `WaitForResolution` polling every 2s until the script resolves the request. The timing is:
- Agent starts, calls request_human → blocks
- Script polls /api/requests (every 5s for up to 2 min)
- Script resolves request
- Agent unblocks, calls memory_save, completes
- Script polls /api/tasks for completion (every 15s for up to 3 min)

Make executable: `chmod +x scripts/e2e-human-request.sh`

**Step 3: Commit**

```bash
git add testdata/scenarios/human-request.yaml scripts/e2e-human-request.sh
git commit -m "feat: add human-in-the-loop E2E test"
```

---

### Task 5: Approval Flow Scenario + E2E Script

**Files:**
- Create: `testdata/scenarios/approval-flow.yaml`
- Create: `scripts/e2e-approval.sh`

**Step 1: Create the scripted scenario**

Create `testdata/scenarios/approval-flow.yaml`:

```yaml
name: approval-flow
loop: false
description: >
  Agent requests approval before a destructive action. Calls request_approval
  with blocking behavior, waits for human to approve/reject, then continues.

steps:
  # Turn 1: request_approval
  - content: "This action requires human approval before proceeding."
    tool_calls:
      - name: request_approval
        arguments:
          action: "Delete production database backup older than 30 days"
          reason: "Storage cleanup policy requires approval for production data deletion"
          details: "5 backup files totaling 2.3GB from February 2026"

  # Turn 2: After approval — proceed with task
  - content: "Approval granted. Proceeding with the approved action and logging the outcome."
    tool_calls:
      - name: memory_save
        arguments:
          content: "Production backup cleanup approved and executed. 5 files (2.3GB) removed per storage policy."
          tags: "approval,cleanup,production"

  # Turn 3: completion
  - content: "Task complete. Cleanup approved and executed successfully."
```

**Step 2: Create the E2E script**

Create `scripts/e2e-approval.sh`. Same pattern as human-request but:

1. Poll `GET /api/approvals` for pending approval
2. Approve via `POST /api/approvals/{id}/approve` with `{"comment":"Approved for cleanup"}`
3. Verify tool chain: `request_approval` → `memory_save`

Note: The `request_approval` tool returns `{approval_id, status: "pending", ...}`. The agent execute loop detects `tc.Name == "request_approval"` and calls `handleApprovalWait`. The approval manager stores approvals in the `approvals` table.

Make executable: `chmod +x scripts/e2e-approval.sh`

**Step 3: Commit**

```bash
git add testdata/scenarios/approval-flow.yaml scripts/e2e-approval.sh
git commit -m "feat: add approval flow E2E test"
```

---

### Task 6: Sub-Agent Spawning Scenario + E2E Script

**Files:**
- Create: `testdata/scenarios/sub-agent-parent.yaml`
- Create: `scripts/e2e-sub-agent.sh`

**Step 1: Create the parent agent scenario**

Create `testdata/scenarios/sub-agent-parent.yaml`:

```yaml
name: sub-agent-parent
loop: false
description: >
  Orchestrator agent spawns a sub-agent for a subtask, waits for it to complete,
  then saves the result to memory.

steps:
  # Turn 1: spawn sub-agent
  - content: "This task is complex. I'll delegate the file analysis subtask to a sub-agent."
    tool_calls:
      - name: agent_spawn
        arguments:
          name: "file-analyzer"
          task: "Analyze the project structure and report key files"
          system_prompt: "You are a file analysis agent. Use file_read to examine project files and report findings."

  # Turn 2: wait for sub-agent to complete
  - content: "Sub-agent spawned. Waiting for the file analysis to complete."
    tool_calls:
      - name: agent_wait
        arguments:
          timeout: 180

  # Turn 3: save result to memory
  - content: "Sub-agent completed. Saving the analysis results to memory."
    tool_calls:
      - name: memory_save
        arguments:
          content: "File analysis completed by sub-agent. Project structure documented."
          tags: "sub-agent,analysis"

  # Turn 4: completion
  - content: "Task complete. Sub-agent results incorporated."
```

**Step 2: Create the E2E script**

Create `scripts/e2e-sub-agent.sh`. Key considerations:

1. The sub-agent created by `agent_spawn` gets a task in the DB with `status: pending`
2. The parent agent blocks inside `agent_wait` polling every 2s
3. The sub-agent task is picked up by the next `agent-tick` cycle (every minute with fast cron)
4. The sub-agent needs its own scripted scenario — but the test provider is configured per-server, not per-agent
5. **Important:** The test provider serves responses to ALL agents sequentially. The sub-agent will consume the next scripted step from the same scenario. So the scenario must account for both parent AND sub-agent turns interleaved.

**Alternative approach:** Since the sub-agent will also use the scripted provider, we need the scenario to include the sub-agent's response. The `agent_wait` tool polls the DB — it doesn't consume a scripted turn. But the sub-agent's `step.agent_execute` will consume scripted turns. The scenario should have:
- Parent turn 1: agent_spawn
- Parent turn 2: agent_wait (this is a tool call, but the blocking happens in Go code, not the provider — it doesn't consume a scripted turn because the agent loop's `handleSubAgentWait` or similar logic handles it)

**Actually:** Looking at `step_agent_execute.go`, `agent_wait` is a regular tool. The agent calls it, gets a result (the wait is synchronous in the tool's Execute method, not in the step). So `agent_wait` does NOT block the provider — the tool itself blocks. After `agent_wait` returns, the provider is asked for the next response.

The sub-agent runs in a separate `step.agent_execute` invocation (separate agent-tick cycle). It gets its own provider context. Since `RATCHET_AI_SCENARIO` is global, the sub-agent will read from the same scenario file — but each `step.agent_execute` creates a fresh `NewScriptedSourceFromScenario()`. So both parent and sub-agent get their own copy of the scenario steps.

**This means:** The sub-agent will play through the scenario from step 1 again. We need the scenario to work for both parent and sub-agent. The simplest fix: use `loop: true` so the sub-agent can consume steps. Or create a scenario where the first few steps work for both agents.

**Simplest approach:** Since the sub-agent's scripted response will use the same scenario, and the sub-agent only needs 1-2 turns, we make the scenario generic enough that a file_read call works as the first step. Actually, re-reading the code: `NewScriptedSourceFromScenario` creates a new `ScriptedSource` per invocation. Each `step.agent_execute` creates its own source. So both parent and child get independent copies starting from step 0.

For the sub-agent, its `step.agent_execute` will use the same scenario — so step 0 (`agent_spawn`) will be the sub-agent's first response. The sub-agent calling `agent_spawn` is weird but won't crash (it'll fail because depth limit is 1). Better approach: use `loop: true` and have the scenario be generic enough, or accept that the sub-agent test is timing-sensitive.

**Practical approach for E2E:** Keep the scenario simple. The sub-agent will try to execute the same scenario steps, which means it'll call `agent_spawn` again — but `SubAgentManager.Spawn` rejects recursive spawning (`depth > maxDepth`). The sub-agent will get an error for agent_spawn, then on the next turn will call agent_wait (which will fail since it has no children). On turn 3, it calls memory_save (which succeeds). On turn 4, it completes (no tool_calls). The sub-agent task will end up `completed` because the agent loop ran through all steps.

This is messy. Better: create a separate simple scenario for the sub-agent or accept that the e2e test verifies the spawn mechanism works even if the sub-agent's execution is imperfect.

**Final approach:** Verify that `agent_spawn` creates the sub-agent and task in the DB, and `agent_wait` receives a result when the sub-agent task completes. Don't worry about the sub-agent's internal tool chain — just verify the parent's chain.

Make executable: `chmod +x scripts/e2e-sub-agent.sh`

**Step 3: Commit**

```bash
git add testdata/scenarios/sub-agent-parent.yaml scripts/e2e-sub-agent.sh
git commit -m "feat: add sub-agent spawning E2E test"
```

---

### Task 7: Webhook-Triggered Task Scenario + E2E Script

**Files:**
- Create: `testdata/scenarios/webhook-task.yaml`
- Create: `scripts/e2e-webhook.sh`

**Step 1: Create the scripted scenario**

Create `testdata/scenarios/webhook-task.yaml`:

```yaml
name: webhook-task
loop: false
description: >
  Developer agent handles a task created by a GitHub webhook.
  Reviews the referenced code and saves findings to memory.

steps:
  # Turn 1: code_review
  - content: "A new GitHub issue was filed. Let me review the related code."
    tool_calls:
      - name: code_review
        arguments:
          path: "."

  # Turn 2: save findings
  - content: "Review complete. Saving findings to memory."
    tool_calls:
      - name: memory_save
        arguments:
          content: "Webhook-triggered code review completed for GitHub issue. No critical issues found."
          tags: "webhook,github,code-review"

  # Turn 3: completion
  - content: "Webhook task complete. Code reviewed and findings logged."
```

**Step 2: Create the E2E script**

Create `scripts/e2e-webhook.sh`:

1. Start server
2. Authenticate
3. Create webhook: `POST /api/webhooks` with body:
   ```json
   {
     "source": "github",
     "event_filter": "issues.opened",
     "task_template": "title: GitHub Issue: {{.payload.issue.title}}\ndescription: Issue opened by {{.payload.user.login}}: {{.payload.issue.body}}",
     "enabled": true,
     "task_role": "developer"
   }
   ```
   Note: The webhook table may or may not have a `task_role` field. Check `step_webhook.go` — if the rendered task doesn't set `task_role`, we may need to add it. If not available, the task will be assigned randomly by agent-tick.

4. Send GitHub webhook: `POST /api/webhooks/receive/github` with headers `X-GitHub-Event: issues` and body:
   ```json
   {
     "action": "opened",
     "issue": {"title": "Fix login timeout", "body": "Users report 30s timeout on login page"},
     "user": {"login": "testuser"}
   }
   ```

5. Verify task created in `/api/tasks` with title containing "GitHub Issue"
6. Wait for agent-tick to assign and execute
7. Verify tool chain: `code_review` → `memory_save`

Make executable: `chmod +x scripts/e2e-webhook.sh`

**Step 3: Commit**

```bash
git add testdata/scenarios/webhook-task.yaml scripts/e2e-webhook.sh
git commit -m "feat: add webhook-triggered task E2E test"
```

---

### Task 8: Browser QA Scenario + E2E Script

**Files:**
- Create: `testdata/scenarios/browser-qa.yaml`
- Create: `testdata/test-page.html`
- Create: `scripts/e2e-browser.sh`

**Step 1: Create test HTML page**

Create `testdata/test-page.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Ratchet Test Page</title></head>
<body>
<h1>Browser Test</h1>
<p id="status">All systems operational</p>
<div class="info">Version 1.0.0</div>
</body>
</html>
```

**Step 2: Create the scripted scenario**

Create `testdata/scenarios/browser-qa.yaml`:

```yaml
name: browser-qa
loop: false
description: >
  Agent navigates to a test page, extracts content, and takes a screenshot.

steps:
  # Turn 1: navigate to test page
  - content: "Navigating to the test page to verify it loads correctly."
    tool_calls:
      - name: browser_navigate
        arguments:
          url: "http://localhost:18888/test-page.html"

  # Turn 2: extract h1 content
  - content: "Page loaded. Extracting the heading content."
    tool_calls:
      - name: browser_extract
        arguments:
          selector: "h1"

  # Turn 3: take screenshot
  - content: "Content extracted. Taking a screenshot for the record."
    tool_calls:
      - name: browser_screenshot
        arguments: {}

  # Turn 4: completion
  - content: "Browser QA complete. Page loads correctly, heading says 'Browser Test', screenshot captured."
```

**Step 3: Create the E2E script**

Create `scripts/e2e-browser.sh`:

1. Check if Chrome/Chromium is available: `which chromium || which google-chrome || which chromium-browser`. If not found, print `[SKIP] Chrome not available` and exit 0.
2. Start a Python HTTP server: `python3 -m http.server 18888 --directory testdata &`
3. Start ratchetd with browser-qa scenario
4. Create task, wait for execution
5. Verify tool chain: `browser_navigate` → `browser_extract` → `browser_screenshot`
6. Clean up Python server

Make executable: `chmod +x scripts/e2e-browser.sh`

**Step 4: Commit**

```bash
git add testdata/scenarios/browser-qa.yaml testdata/test-page.html scripts/e2e-browser.sh
git commit -m "feat: add browser QA E2E test (Chrome-gated)"
```

---

### Task 9: Tool Policy Enforcement Scenario + E2E Script

**Files:**
- Create: `testdata/scenarios/tool-policy.yaml`
- Create: `scripts/e2e-tool-policy.sh`

**Step 1: Create the scripted scenario**

Create `testdata/scenarios/tool-policy.yaml`:

```yaml
name: tool-policy
loop: false
description: >
  Agent attempts to use a denied tool (shell_exec), gets blocked by policy,
  then falls back to an allowed tool (file_read).

steps:
  # Turn 1: try shell_exec (will be denied by policy)
  - content: "Let me run a quick shell command to check the system."
    tool_calls:
      - name: shell_exec
        arguments:
          command: "echo hello"

  # Turn 2: fall back to file_read after denial
  - content: "Shell access was denied by policy. Using file_read instead."
    tool_calls:
      - name: file_read
        arguments:
          path: "ratchet.yaml"

  # Turn 3: completion
  - content: "Task complete. Used file_read as fallback after shell_exec was denied."
```

**Step 2: Create the E2E script**

Create `scripts/e2e-tool-policy.sh`:

1. Start server
2. Authenticate
3. Create a deny policy: `POST /api/tool-policies` with:
   ```json
   {"tool_pattern": "shell_exec", "action": "deny", "scope": "global", "reason": "Shell access restricted in E2E test"}
   ```
4. Create a task and wait for execution
5. Check transcripts — verify `shell_exec` was called but returned a denial error
6. Verify `file_read` was called and succeeded
7. Verify task completed (agent recovered from denied tool)

Make executable: `chmod +x scripts/e2e-tool-policy.sh`

**Step 3: Commit**

```bash
git add testdata/scenarios/tool-policy.yaml scripts/e2e-tool-policy.sh
git commit -m "feat: add tool policy enforcement E2E test"
```

---

### Task 10: MCP Server E2E Script

**Files:**
- Create: `scripts/e2e-mcp.sh`

**Step 1: Create the E2E script**

Create `scripts/e2e-mcp.sh`:

This is NOT a scripted provider test — it's a direct HTTP test against the MCP server endpoint.

1. Start ratchetd (normal config, no test provider needed)
2. Authenticate
3. Test `tools/list`: `POST /mcp` with JSON-RPC:
   ```json
   {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
   ```
4. Verify response contains `ratchet_list_agents`, `ratchet_create_task`, etc.
5. Test `tools/call` with `ratchet_list_agents`:
   ```json
   {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "ratchet_list_agents", "arguments": {}}}
   ```
6. Verify response contains agent data

Note: The MCP server endpoint may not require JWT auth (it's an MCP protocol endpoint). Check the route config — if it's behind auth middleware, include the Bearer token. If it uses the `public_mw` group, no auth needed.

Make executable: `chmod +x scripts/e2e-mcp.sh`

**Step 2: Commit**

```bash
git add scripts/e2e-mcp.sh
git commit -m "feat: add MCP server JSON-RPC E2E test"
```

---

### Task 11: Container Control E2E Script

**Files:**
- Create: `scripts/e2e-container.sh`

**Step 1: Create the E2E script**

Create `scripts/e2e-container.sh`:

1. Check Docker availability: `docker info > /dev/null 2>&1`. If fails, print `[SKIP] Docker not available` and exit 0.
2. Start ratchetd
3. Authenticate
4. Create a project via API: `POST /api/projects` with `{"name": "e2e-container-test", "workspace_path": "/tmp/e2e-container-workspace"}`
5. This test exercises the container lifecycle via direct API calls that trigger pipeline steps, or via a custom task. The container_control step requires a pipeline context — so we may need to trigger it via a pipeline or API route.

**Alternative:** Since `step.container_control` is a pipeline step (not an agent tool), and there are routes for `POST /api/projects/{id}/container/start`, this can be tested via those routes directly:

- `POST /api/projects/{id}/container/start` with `{"image": "alpine:latest", "init_commands": ["apk add --no-cache curl"]}`
- `GET /api/projects/{id}/container/status`
- `POST /api/projects/{id}/container/stop`

6. Verify container started, status reported, stopped
7. Clean up: remove project

Make executable: `chmod +x scripts/e2e-container.sh`

**Step 2: Commit**

```bash
git add scripts/e2e-container.sh
git commit -m "feat: add container control E2E test (Docker-gated)"
```

---

### Task 12: Skill System E2E + Test Skill File

**Files:**
- Create: `testdata/skills/infrastructure-runbook.md`
- Modify: one of the E2E scripts (team-coordination or human-request) to also test skill assignment

**Step 1: Create the test skill file**

Create `testdata/skills/infrastructure-runbook.md`:

```markdown
---
name: Infrastructure Runbook
description: Standard procedures for infrastructure operations
category: operations
---

## Infrastructure Runbook

When handling infrastructure issues:
1. Always check pod health before making changes
2. Prefer rollback over manual fixes
3. Document all actions taken in memory
4. Escalate to human if more than 2 consecutive failures
```

**Step 2: Add skill testing to team-coordination E2E**

In `scripts/e2e-team-coordination.sh`, after authentication and before task creation, add:

```bash
# ---- Assign skill to developer agent ----
info "Listing available skills..."
SKILLS=$(curl -sf "$RATCHET_URL/api/skills" -H "Authorization: Bearer $TOKEN")
SKILL_ID=$(echo "$SKILLS" | python3 -c "
import sys, json
skills = json.load(sys.stdin)
for s in (skills if isinstance(skills, list) else []):
    if 'infrastructure' in s.get('id','').lower() or 'runbook' in s.get('name','').lower():
        print(s['id'])
        break
" 2>/dev/null)

if [ -n "$SKILL_ID" ]; then
    curl -sf -X POST "$RATCHET_URL/api/agents/$DEVELOPER_ID/skills" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"skill_id\":\"$SKILL_ID\"}" > /dev/null
    pass "Assigned skill '$SKILL_ID' to developer"
else
    info "No skills found (skill dir may not be configured)"
fi
```

Note: The skill manager loads from `skills/` directory at startup. For the E2E test, we need to ensure ratchetd loads skills from `testdata/skills/`. This might require a config change or env var. Check `skillManagerHook` — if the directory is hardcoded to `"skills"`, we may need to create a symlink or copy the file. Alternatively, create a `skills/` directory in the project root with the test skill.

**Step 3: Commit**

```bash
git add testdata/skills/infrastructure-runbook.md
git commit -m "feat: add test skill file and skill assignment E2E"
```

---

### Task 13: Final Verification

**Step 1: Run all existing E2E tests to verify no regressions**

```bash
go test -race ./... -count=1
```

**Step 2: Run go fmt and lint**

```bash
go fmt ./...
golangci-lint run
```

**Step 3: Final commit if needed**

```bash
git add -A
git commit -m "fix: final adjustments for complete E2E coverage"
```

**Step 4: Build and deploy**

```bash
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/ratchetd-linux-arm64 ./cmd/ratchetd/
# docker build, minikube load, kubectl set image — standard pattern
```
