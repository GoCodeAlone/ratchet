# CLAUDE.md — Ratchet

Autonomous AI agent orchestration platform built natively on GoCodeAlone/workflow. Agents ratchet forward — consistent, irreversible progress.

## Build & Test

```bash
# Build everything
make build

# Build individually
make build-cli      # CLI: bin/ratchet
make build-server   # Server: bin/ratchetd

# Test
go test ./...
go test -race ./...
go test -v -run TestName ./package/

# Lint
go fmt ./...
golangci-lint run

# Dev server
make dev            # builds and runs with ratchet.yaml

# UI
cd ui && npm install && npm run dev   # dev server
cd ui && npm run build                # production build
cd ui && npm test                     # tests
```

## Architecture

Ratchet runs entirely on the **GoCodeAlone/workflow engine**. The server is config-driven — `ratchet.yaml` declares all modules, HTTP routes, pipeline steps, and scheduled triggers. The only custom Go code is the `ratchetplugin` package.

**What workflow provides (no custom Go):**
- HTTP server, router, middleware (CORS, rate limiting, auth)
- Static file serving (React UI with SPA fallback)
- SQLite database
- REST API endpoints via pipeline steps
- Scheduled agent polling
- Inter-agent messaging via messaging broker

**What requires custom Go (`ratchetplugin/`):**
- `step.agent_execute` — autonomous agent loop (LLM call → tool execution → repeat)
- `ratchet.ai_provider` — module that wraps AI providers (mock, anthropic, openai)
- `ratchet.sse_hub` — SSE endpoint for real-time dashboard updates
- `ratchet.db_init` — wiring hook to create DB tables and seed agents

**Core concepts:**
- **Agent**: Autonomous AI entity with personality, defined in YAML, stored in SQLite
- **Provider**: AI backend (Mock built-in; Anthropic/OpenAI via config)
- **Task**: Unit of work, managed entirely via DB pipeline steps
- **Team**: Group of agents with optional lead (derived from agent team_id)
- **Pipeline**: Declarative workflow of steps (parse → query → respond)
- **Trigger**: HTTP routes and cron schedules that invoke pipelines

**Package layout:**

| Package | Role |
|---------|------|
| `ratchetplugin/` | Workflow EnginePlugin — custom modules, steps, wiring hooks |
| `agent/` | Agent types (Status, Personality, Info) |
| `provider/` | AI provider interface (Provider, Message, ToolDef, Response) |
| `task/` | Task model (Task, Status, Priority) |
| `plugin/` | Tool interface for agent extensions |
| `update/` | Self-update mechanism (GitHub releases) |
| `cmd/ratchet/` | CLI binary (HTTP client) |
| `cmd/ratchetd/` | Server daemon (thin workflow engine bootstrap) |
| `ui/` | React + Vite dashboard |
| `internal/version/` | Build-time version info |

**Config-driven flow:**
1. `cmd/ratchetd/main.go` loads `ratchet.yaml` → `config.WorkflowConfig`
2. Creates workflow engine, loads builtin plugins + `ratchetplugin.New()`
3. `engine.BuildFromConfig()` instantiates all modules, wires pipelines, registers routes
4. `ratchet.db_init` hook creates tables and seeds agents
5. HTTP trigger handles API requests → pipeline steps → SQLite → JSON response
6. Schedule trigger fires `agent-tick` pipeline every minute → processes pending tasks

## Key Files

| File | Purpose |
|------|---------|
| `ratchet.yaml` | Complete server config (modules, routes, pipelines, triggers) |
| `ratchetplugin/plugin.go` | EnginePlugin registration (module/step/hook factories) |
| `ratchetplugin/db.go` | DB schema init + agent seeding wiring hook |
| `ratchetplugin/module_ai_provider.go` | AI provider module with mock implementation |
| `ratchetplugin/step_agent_execute.go` | Autonomous agent loop pipeline step |
| `ratchetplugin/module_sse_hub.go` | SSE real-time events module |
| `cmd/ratchetd/main.go` | ~100 line engine bootstrap |
| `cmd/ratchet/main.go` | CLI client (unchanged) |

## Key Conventions

- Go 1.26+, module path `github.com/GoCodeAlone/ratchet`
- Depends on `github.com/GoCodeAlone/workflow` (local replace directive in go.mod)
- Always run `go fmt` and `golangci-lint` before committing
- Use `-race` flag for tests involving concurrency
- SQLite via `storage.sqlite` module, tables created by `ratchet.db_init` hook
- YAML config drives everything — modify `ratchet.yaml` to add routes/pipelines
- Mock provider for all testing — never require real AI API keys in tests
- API endpoints: `POST /api/auth/login`, `GET/POST /api/agents`, `GET/POST /api/tasks`, etc.
- Server port: `:9090` (configured in ratchet.yaml)
