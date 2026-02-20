# Ratchet

Autonomous AI agent orchestration platform. Agents that ratchet forward — consistent, irreversible progress.

Built on [GoCodeAlone/workflow](https://github.com/GoCodeAlone/workflow).

## Features

- **Multi-agent orchestration** — Run teams of AI agents that work autonomously on tasks
- **Lead agent / orchestrator** — Optional team lead that plans, delegates, and coordinates
- **Inter-agent communication** — Agents communicate mid-stream via a message bus, coordinating without blocking
- **Multiple AI providers** — Anthropic Claude, OpenAI ChatGPT, or Mock (for testing)
- **Web dashboard** — Real-time mission control for monitoring agents, tasks, and communications
- **CLI** — Command-line interface for managing agents and tasks
- **Plugin system** — Extend agent capabilities with custom tools
- **Self-updating** — Automatic updates from GitHub releases
- **Cross-platform** — Windows, macOS, Linux

## Quick Start

```bash
# Clone and build
git clone https://github.com/GoCodeAlone/ratchet.git
cd ratchet
make build

# Start the server with the sample config
./bin/ratchetd --config ratchet.yaml

# Or use the dev script
./scripts/dev.sh
```

The dashboard will be available at **http://localhost:9090** (login: admin/admin).

## CLI

```bash
# Check server status
./bin/ratchet status

# List agents
./bin/ratchet agents

# Start/stop an agent
./bin/ratchet agent start orchestrator
./bin/ratchet agent stop developer

# List tasks
./bin/ratchet tasks

# Create a task
./bin/ratchet task create "Build the login page"

# Check version
./bin/ratchet version
```

## Configuration

Ratchet is configured via YAML. See `ratchet.yaml` for a full example:

```yaml
server:
  addr: ":9090"
auth:
  admin_user: admin
  admin_pass: admin
agents:
  - id: orchestrator
    name: Orchestrator
    role: lead
    system_prompt: "You are the lead orchestrator..."
    provider: mock
    is_lead: true
    team_id: alpha
  - id: developer
    name: Developer
    role: developer
    system_prompt: "You are a software developer..."
    provider: anthropic
    model: claude-sonnet-4-6
    team_id: alpha
```

## Architecture

```
                    ┌─────────────┐
                    │  Dashboard  │  React + Vite
                    │  (Web UI)   │  SSE real-time
                    └──────┬──────┘
                           │ HTTP/SSE
                    ┌──────┴──────┐
                    │   Server    │  REST API + Auth
                    │  (ratchetd) │  JWT authentication
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────┴─────┐ ┌───┴───┐ ┌─────┴─────┐
        │   Agent    │ │ Agent │ │   Agent    │
        │ (Lead)     │ │       │ │            │
        └─────┬─────┘ └───┬───┘ └─────┬─────┘
              │            │            │
              └────────────┼────────────┘
                           │
                    ┌──────┴──────┐
                    │  Comms Bus  │  Inter-agent messaging
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────┴─────┐ ┌───┴───┐ ┌─────┴─────┐
        │ Task Store │ │Provider│ │  Plugins  │
        │  (SQLite)  │ │(AI API)│ │  (Tools)  │
        └───────────┘ └───────┘ └───────────┘
```

## Development

```bash
# Build
make build

# Test
make test

# Lint
make lint

# UI development
cd ui && npm run dev
```

## License

MIT
