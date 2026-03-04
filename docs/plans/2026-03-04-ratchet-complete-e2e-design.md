# Ratchet Complete E2E Coverage — Design

## Goal

Close all gaps between Ratchet's implemented capabilities and tested capabilities. Every wired feature gets an E2E test. Three code fixes unblock features that are built but not fully operational.

## Current State

**Tested (4 domains):** Infrastructure self-healing, development code review, security scanning, data analysis. All have E2E scripts, scripted scenarios, and verified tool chains.

**Untested (7+ features):** Team coordination, human-in-the-loop, approval flow, sub-agent spawning, webhooks, browser automation, tool policy enforcement, container control, MCP integration, skill system. All are fully implemented in Go but have zero E2E coverage.

**42 of 61 API routes** (69%) are not exercised by any E2E test.

## Code Fixes (3)

### Fix 1: Role-Based Task Routing in agent-tick

**Problem:** The `auto-assign-tasks` step in `config/pipelines.yaml` uses `ORDER BY RANDOM() LIMIT 1` with no role awareness. An orchestrator gets the same random assignment as a developer.

**Fix:** Add a `task_role` column to the `tasks` table (nullable). When set, the assignment query matches `task_role` against the agent's `role`. When null, any idle agent can pick it up.

**SQL change in `ratchetplugin/db.go` (schema):**
```sql
ALTER TABLE tasks ADD COLUMN task_role TEXT;
```

**SQL change in `config/pipelines.yaml` (auto-assign-tasks step):**
```sql
UPDATE tasks SET assigned_to = (
  SELECT a.id FROM agents a
  WHERE a.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM tasks t2 WHERE t2.assigned_to = a.id AND t2.status = 'in_progress')
    AND (tasks.task_role IS NULL OR a.role = tasks.task_role)
  ORDER BY RANDOM() LIMIT 1
)
WHERE status = 'pending' AND assigned_to IS NULL
LIMIT 1
```

**Backward compatible:** Existing tasks with no `task_role` work as before.

### Fix 2: MCP Server Route Wiring

**Problem:** The MCP server module (`ratchetplugin/module_mcp_server.go`) implements `ServeHTTP()` and exposes `Path()` but its route is never registered on the HTTP router. The module sits in the service registry doing nothing.

**Fix:** Add a wiring hook (e.g., `mcpServerRouteHook`) that looks up the MCP server module from the service registry and registers it as an HTTP handler at its configured path on the router.

### Fix 3: Remove Dead `required_tools` Field

**Problem:** The `required_tools` column in the `skills` table and YAML frontmatter is stored but never enforced or read by the agent execute loop.

**Fix:** Leave the column (harmless), but remove any code that parses or stores `required_tools` if it adds complexity. If it's just a string column that gets stored and ignored, leave it alone. YAGNI — don't build enforcement.

**Decision:** Keep column, ignore it. No code change needed.

## E2E Scenarios (7 new scripts + scenarios)

Each follows the proven pattern: scripted test provider drives the agent through a tool chain, E2E bash script verifies completion.

### Scenario 1: Team Coordination (`e2e-team-coordination.sh`)

**What it tests:** Role-based task assignment, agent-tick auto-execution, inter-agent messaging.

**Setup:**
- Server starts with 3 alpha-team agents: orchestrator (lead), developer, reviewer
- E2E script creates a task via API with `task_role: development`

**Flow:**
1. agent-tick fires, assigns task to developer agent (role match)
2. Developer's scripted response: `code_review` → `message_send` (notify reviewer)
3. Verify task completed by developer (not orchestrator or reviewer)
4. Verify message in `/api/messages`

**Scripted scenario:** `testdata/scenarios/team-coordination.yaml`

**Tool chain verified:** `code_review` → `message_send`

### Scenario 2: Human-in-the-Loop (`e2e-human-request.sh`)

**What it tests:** Blocking human requests, HTTP resolution, agent continuation after unblock.

**Setup:**
- Agent receives task, scripted to call `request_human` with `blocking: true`, `request_type: info`
- E2E script acts as the human operator

**Flow:**
1. Agent calls `request_human` → blocks
2. E2E script polls `GET /api/requests` until request appears
3. E2E script calls `POST /api/requests/{id}/resolve` with `response_data`
4. Agent unblocks, receives response, calls `memory_save`

**Scripted scenario:** `testdata/scenarios/human-request.yaml`

**Tool chain verified:** `request_human` → [human resolves via API] → `memory_save`

### Scenario 3: Approval Flow (`e2e-approval.sh`)

**What it tests:** Approval creation, blocking wait, HTTP approve endpoint, agent continuation.

**Setup:**
- Agent scripted to call `request_approval` with `blocking: true` for a production deployment decision

**Flow:**
1. Agent calls `request_approval` → blocks
2. E2E script polls `GET /api/approvals` until approval appears
3. E2E script calls `POST /api/approvals/{id}/approve`
4. Agent unblocks and continues

**Scripted scenario:** `testdata/scenarios/approval-flow.yaml`

**Tool chain verified:** `request_approval` → [human approves via API] → `task_update`

### Scenario 4: Sub-Agent Spawning (`e2e-sub-agent.sh`)

**What it tests:** Sub-agent creation, agent-tick executing sub-agent, blocking wait, result propagation.

**Setup:**
- Orchestrator agent receives complex task
- Orchestrator's scripted response calls `agent_spawn` then `agent_wait`
- Sub-agent has its own scripted response

**Flow:**
1. Orchestrator calls `agent_spawn` with subtask description
2. Sub-agent created in DB (ephemeral, parent_agent_id set)
3. Orchestrator calls `agent_wait` → blocks polling DB
4. Next agent-tick picks up sub-agent's task, executes it
5. Sub-agent calls `file_read`, completes
6. Orchestrator unblocks, receives result, calls `memory_save`

**Scripted scenarios:**
- `testdata/scenarios/sub-agent-parent.yaml` (orchestrator)
- `testdata/scenarios/sub-agent-child.yaml` (ephemeral sub-agent)

**Key timing:** agent-tick runs every minute. Sub-agent must complete before parent's wait timeout (default 5 min). E2E script uses fast cron (`* * * * *`).

**Tool chain verified (parent):** `agent_spawn` → `agent_wait` → `memory_save`
**Tool chain verified (child):** `file_read`

### Scenario 5: Webhook-Triggered Task (`e2e-webhook.sh`)

**What it tests:** Webhook CRUD API, payload reception, event filtering, task template rendering, automatic agent execution.

**Setup:**
- E2E script creates a webhook via `POST /api/webhooks` (source: "github", filter: "issues.opened", template with `{{.payload.issue.title}}`)

**Flow:**
1. `POST /api/webhooks/receive/github` with GitHub-formatted payload (`X-GitHub-Event: issues`, body with `action: opened`)
2. `step.webhook_process` creates a task from template
3. agent-tick assigns to developer agent (task_role: development)
4. Developer scripted response: `code_review` → `memory_save`

**Scripted scenario:** `testdata/scenarios/webhook-task.yaml`

**Tool chain verified:** [webhook] → task created → `code_review` → `memory_save`

### Scenario 6: Browser QA (`e2e-browser.sh`)

**What it tests:** Browser lazy init, page navigation, screenshot capture, DOM extraction.

**Precondition:** Chrome/Chromium installed. Test gracefully skips if unavailable.

**Setup:**
- E2E script starts a simple Python HTTP server serving a test HTML page
- Agent scripted to call browser tools against that URL

**Flow:**
1. Agent calls `browser_navigate` with `http://localhost:PORT/test.html`
2. Agent calls `browser_extract` with CSS selector `h1`
3. Agent calls `browser_screenshot`
4. Verify transcript contains title text and base64 screenshot data

**Scripted scenario:** `testdata/scenarios/browser-qa.yaml`

**Tool chain verified:** `browser_navigate` → `browser_extract` → `browser_screenshot`

### Scenario 7: Tool Policy Enforcement (`e2e-tool-policy.sh`)

**What it tests:** Policy CRUD API, deny-wins enforcement, per-tool blocking, allowed tools still work.

**Setup:**
- E2E script creates a deny policy: `POST /api/tool-policies` with `{tool_pattern: "shell_exec", action: "deny"}`

**Flow:**
1. Agent receives task, scripted response calls `shell_exec`
2. Tool execution blocked by policy → agent gets denial error
3. Agent's next scripted response calls `file_read` (allowed) → succeeds
4. Task completes

**Scripted scenario:** `testdata/scenarios/tool-policy.yaml`

**Tool chain verified:** `shell_exec` (denied) → `file_read` (allowed)

## Dependency-Gated Tests (2)

### Container Control (`e2e-container.sh`)

**Precondition:** Docker daemon running. Graceful skip if unavailable.

**Flow:** Create project via API → `step.container_control` starts Alpine container → exec command inside → stop → remove.

**Not a scripted scenario** — this is a pipeline-level test (container_control is a pipeline step, not an agent tool). The E2E script creates a project, then triggers a pipeline that exercises container lifecycle.

### MCP Integration (`e2e-mcp.sh`)

**Precondition:** After Fix 2 wires the route.

**Flow:** Call the MCP server endpoint at `/mcp` with JSON-RPC `tools/list` request → verify ratchet tools listed in response. Then `tools/call` with `ratchet_list_agents` → verify agents returned.

**This tests the MCP server only** (no external MCP client binary needed). The MCP client test would need a stub MCP server binary, which we skip for now.

## Skill System E2E

**Bundled into team-coordination or human-request test** rather than standalone:
1. Ship `testdata/skills/test-skill.md` with frontmatter
2. Configure server to load skills from `testdata/skills/`
3. Assign skill to agent via `POST /api/agents/{id}/skills`
4. Verify skill content in transcripts after agent execution

## File Summary

### New files
| File | Purpose |
|------|---------|
| `testdata/scenarios/team-coordination.yaml` | Scripted provider for team test |
| `testdata/scenarios/human-request.yaml` | Scripted provider for human-in-the-loop |
| `testdata/scenarios/approval-flow.yaml` | Scripted provider for approval test |
| `testdata/scenarios/sub-agent-parent.yaml` | Scripted provider for orchestrator |
| `testdata/scenarios/sub-agent-child.yaml` | Scripted provider for ephemeral sub-agent |
| `testdata/scenarios/webhook-task.yaml` | Scripted provider for webhook-triggered task |
| `testdata/scenarios/browser-qa.yaml` | Scripted provider for browser test |
| `testdata/scenarios/tool-policy.yaml` | Scripted provider for policy test |
| `testdata/skills/test-skill.md` | Test skill for skill system E2E |
| `testdata/test-page.html` | Simple HTML page for browser test |
| `scripts/e2e-team-coordination.sh` | E2E: team role-based assignment |
| `scripts/e2e-human-request.sh` | E2E: blocking human request + resolution |
| `scripts/e2e-approval.sh` | E2E: approval flow |
| `scripts/e2e-sub-agent.sh` | E2E: sub-agent spawning + wait |
| `scripts/e2e-webhook.sh` | E2E: webhook → task → agent |
| `scripts/e2e-browser.sh` | E2E: browser automation (Chrome-gated) |
| `scripts/e2e-tool-policy.sh` | E2E: policy deny/allow enforcement |
| `scripts/e2e-container.sh` | E2E: container lifecycle (Docker-gated) |
| `scripts/e2e-mcp.sh` | E2E: MCP server JSON-RPC |

### Modified files
| File | Change |
|------|--------|
| `ratchetplugin/db.go` | Add `task_role TEXT` column to tasks schema |
| `config/pipelines.yaml` | Role-aware assignment SQL in auto-assign-tasks |
| `ratchetplugin/plugin.go` | Add MCP server route wiring hook |
| `ratchetplugin/module_mcp_server.go` | Expose method for route registration if needed |
| `config/routes-tasks.yaml` | Add `task_role` to task creation pipeline |

## Success Criteria

- All 7 core E2E scripts pass with `RATCHET_AI_PROVIDER=test`
- Container E2E passes when Docker is available (skips gracefully otherwise)
- Browser E2E passes when Chrome is available (skips gracefully otherwise)
- MCP E2E passes after route wiring fix
- Zero regressions on existing 4 E2E tests
- `go test -race ./...` passes
- `golangci-lint run` passes
