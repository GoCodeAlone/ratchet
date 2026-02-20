# CLAUDE.md — Ratchet

Autonomous AI agent orchestration platform. Agents ratchet forward — consistent, irreversible progress.

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

Ratchet is an autonomous AI agent orchestration platform built on GoCodeAlone/workflow.

**Core concepts:**
- **Agent**: Autonomous AI entity with personality, tools, and a task queue
- **Provider**: AI backend (Anthropic Claude, OpenAI ChatGPT, GitHub Copilot, Mock)
- **Task**: Unit of work assigned to an agent, with status lifecycle
- **Team**: Group of agents with optional lead/orchestrator
- **Comms Bus**: Inter-agent messaging for real-time coordination
- **Plugin**: Extension point for adding tools and capabilities

**Package layout:**

| Package | Role |
|---------|------|
| `agent/` | Agent interface, runtime loop, personality, team coordination |
| `provider/` | AI provider interface + implementations (mock, anthropic, openai) |
| `task/` | Task model, SQLite store, scheduler |
| `comms/` | Inter-agent message bus (in-process + WebSocket) |
| `plugin/` | Plugin interface, registry, loader |
| `server/` | HTTP server, JWT auth, REST API, WebSocket real-time |
| `config/` | YAML configuration |
| `update/` | Self-update mechanism (GitHub releases) |
| `cmd/ratchet/` | CLI binary |
| `cmd/ratchetd/` | Server/daemon binary |
| `ui/` | React + Vite dashboard |
| `internal/version/` | Build-time version info |

## Key Conventions

- Go 1.26+, module path `github.com/GoCodeAlone/ratchet`
- Always run `go fmt` and `golangci-lint` before committing
- Use `-race` flag for tests involving concurrency
- SQLite for persistence, `SetMaxOpenConns(1)` on all DB connections
- YAML for configuration files
- JWT for dashboard authentication
- Mock provider for all testing — never require real AI API keys in tests
