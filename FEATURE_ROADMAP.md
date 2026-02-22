# Ratchet Feature Roadmap

Derived from OpenClaw audit — 10 features to reach parity with best-in-class autonomous agent platforms.

## Must-Have (High Impact)

### 1. Semantic Memory System
**Status**: Complete

Vector-indexed persistent memory with hybrid search (70% semantic + 30% BM25). Agents currently have zero memory between tasks.

- SQLite `memory_entries` table with FTS5 for BM25, cosine similarity for vector search
- New provider method `Embed(ctx, text) ([]float32, error)`
- Agent tools: `memory_search(query, limit)`, `memory_save(content, category)`
- Auto-extraction of key decisions from transcripts at task completion
- Memory injection into system prompt before each task

### 2. Loop Detection / Circuit Breakers
**Status**: Complete

Detects and breaks agent execution loops:
- Identical consecutive tool calls (warn at 2, break at 3)
- Same tool call + same error repeated (break at 2)
- Alternating A/B/A/B pattern (break at 3 cycles)
- No progress (same result N times)
- Injects system warning before hard abort

### 3. Browser Automation
**Status**: Complete

Web browsing capability via Rod (pure Go, `github.com/go-rod/rod`):
- `browser_navigate(url)`, `browser_screenshot()`, `browser_click(selector)`
- `browser_extract(selector)`, `browser_fill(selector, value)`
- Shared browser instance with lazy init and page pool

### 4. Runtime Sub-Agent Spawning
**Status**: Complete

Agents can spawn ephemeral sub-agents for parallel work:
- `agent_spawn(name, task_description, ...)`, `agent_check(sub_task_id)`, `agent_wait(sub_task_ids[])`
- Max 5 concurrent sub-agents per parent, depth=1 only
- Parent cancellation propagates to children
- DB: `parent_id` on tasks, `is_ephemeral`/`parent_agent_id` on agents

## Should-Have (Moderate Impact)

### 5. Context Window Management
**Status**: Complete
**Depends on**: Feature 2 (both modify step_agent_execute.go)

Token counting and automatic context compaction:
- Rough token counter (~4 chars per token)
- Compaction at 80% of model context window
- Auto-summary of compacted messages via LLM
- Model context limit registry (claude-sonnet-4: 200k, gpt-4o: 128k, etc.)

### 6. Granular Tool Policies
**Status**: Complete

Multi-level cascading tool access control:
- Policies: global -> team -> agent, deny-wins
- Tool groups: `group:fs`, `group:runtime`, `group:web`, `group:git`
- Policy evaluation at tool execution time
- DB table `tool_policies`, REST API for CRUD

### 7. Resumable Execution with Approval Gates
**Status**: Complete

Human-in-the-loop approval for sensitive operations:
- `request_approval(action, reason, details?)` tool
- DB table `approvals`, SSE push notifications
- Approve/reject via API with optional comment
- Auto-approve rules, configurable timeout (default 30 min)

## Nice-to-Have

### 8. Skills as Composable Files
**Status**: Complete

Reusable skill definitions in markdown with YAML frontmatter:
- Skills directory with auto-loading
- Skill assignment (many-to-many with agents)
- Skill gating based on required tools/providers
- Built-in starters: code-review, debugging, documentation, testing

### 9. Webhook Inbound Triggers
**Status**: Complete

External event sources that auto-create tasks:
- `POST /api/webhooks/{source}` endpoint
- GitHub, Slack, and generic JSON handlers
- HMAC signature verification
- JSONPath event filters, Go template task mapping

### 10. Security Audit Engine
**Status**: Complete

Platform security assessment with 12 checks:
- Auth, provider, agent, vault, CORS, rate limiting, container, DB, MCP, secrets, webhooks, defaults
- Severity: Critical/High/Medium/Low/Info
- CLI: `ratchet audit`, API: `POST /api/security/audit`
- UI panel in Settings
