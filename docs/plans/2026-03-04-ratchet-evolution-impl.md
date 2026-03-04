# Ratchet Evolution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract generic AI agent primitives from ratchet into `workflow-plugin-agent` Go library, refactor ratchet to consume it, then build the self-healing infrastructure use case with 3-layer testing.

**Architecture:** `workflow-plugin-agent` is a Go library (internal engine plugin, NOT external gRPC) that any workflow app imports with `WithPlugin(agent.New())`. It provides AI provider abstraction, agent execution loop, tool registry framework, memory, loop detection, and context management. Ratchet imports it and wires in its own domain tools, approval gates, and UI. The self-healing infra use case adds k8s-specific tools, skills, and workflow configs.

**Tech Stack:** Go 1.26, GoCodeAlone/workflow v0.3.10, SQLite (FTS5), goreleaser v2, GitHub Actions CI

---

## Phase 1: Create `workflow-plugin-agent` repo

### Task 1: Scaffold the repository

**Files:**
- Create: `workflow-plugin-agent/go.mod`
- Create: `workflow-plugin-agent/plugin.go`
- Create: `workflow-plugin-agent/plugin.json`
- Create: `workflow-plugin-agent/Makefile`
- Create: `workflow-plugin-agent/.goreleaser.yml`
- Create: `workflow-plugin-agent/.github/workflows/ci.yml`
- Create: `workflow-plugin-agent/.github/workflows/release.yml`
- Create: `workflow-plugin-agent/README.md`
- Create: `workflow-plugin-agent/LICENSE`

**Step 1: Create GitHub repo**

```bash
cd /Users/jon/workspace
gh repo create GoCodeAlone/workflow-plugin-agent --private --clone
cd workflow-plugin-agent
```

**Step 2: Initialize Go module**

Create `go.mod`:
```go
module github.com/GoCodeAlone/workflow-plugin-agent

go 1.26

require (
	github.com/CrisisTextLine/modular v1.11.11
	github.com/GoCodeAlone/workflow v0.3.10
	github.com/google/uuid v1.6.0
	modernc.org/sqlite v1.46.1
)
```

Run: `GOPRIVATE=github.com/GoCodeAlone/* go mod tidy`

**Step 3: Create plugin.json**

```json
{
  "name": "workflow-plugin-agent",
  "version": "0.1.0",
  "author": "GoCodeAlone",
  "description": "AI agent primitives for workflow apps — provider abstraction, execution loop, tool registry, memory, loop detection",
  "type": "internal",
  "tier": "core",
  "license": "Proprietary",
  "private": true,
  "minEngineVersion": "0.3.10",
  "keywords": ["agent", "ai", "llm", "provider", "memory", "tools"],
  "homepage": "https://github.com/GoCodeAlone/workflow-plugin-agent",
  "repository": "https://github.com/GoCodeAlone/workflow-plugin-agent",
  "capabilities": {
    "configProvider": false,
    "moduleTypes": ["agent.provider"],
    "stepTypes": ["step.agent_execute", "step.provider_test", "step.provider_models"],
    "triggerTypes": []
  }
}
```

**Step 4: Create Makefile**

```makefile
.PHONY: build test lint clean

MODULE = github.com/GoCodeAlone/workflow-plugin-agent

build:
	GOPRIVATE=github.com/GoCodeAlone/* go build ./...

test:
	GOPRIVATE=github.com/GoCodeAlone/* go test ./... -v -race

lint:
	go vet ./...

clean:
	go clean ./...
```

**Step 5: Create CI workflow**

`.github/workflows/ci.yml` — standard Go CI: checkout, setup-go 1.26, configure private modules, go vet, go test -race

**Step 6: Create release workflow**

`.github/workflows/release.yml` — tag-triggered, goreleaser v2 (even though it's a library, tags are needed for `go get` version resolution)

**Step 7: Create .goreleaser.yml**

Minimal config — no binary builds needed (it's a library), just create GitHub releases from tags.

```yaml
version: 2
builds:
  - skip: true
changelog:
  sort: asc
```

**Step 8: Commit scaffold**

```bash
git add -A
git commit -m "chore: scaffold workflow-plugin-agent repo"
git push -u origin main
```

---

### Task 2: Extract provider package

Copy the provider abstraction from ratchet. This package has zero internal dependencies — it's fully standalone.

**Files:**
- Create: `workflow-plugin-agent/provider/provider.go`
- Create: `workflow-plugin-agent/provider/anthropic.go`
- Create: `workflow-plugin-agent/provider/openai.go`
- Create: `workflow-plugin-agent/provider/copilot.go`
- Create: `workflow-plugin-agent/provider/models.go`
- Create: `workflow-plugin-agent/provider/mock.go`
- Create: `workflow-plugin-agent/provider/test_provider.go`
- Create: `workflow-plugin-agent/provider/test_provider_scripted.go`
- Create: `workflow-plugin-agent/provider/test_provider_channel.go`
- Create: `workflow-plugin-agent/provider/test_provider_http.go`

**Step 1: Copy provider package**

```bash
cp -r /Users/jon/workspace/ratchet/provider/* /Users/jon/workspace/workflow-plugin-agent/provider/
```

**Step 2: Update package references**

Change all `import "github.com/GoCodeAlone/ratchet/provider"` references within the provider package to use the new module path. For the provider package itself, only the module path in go.mod matters — internal imports within the package use relative paths.

The test provider files (`test_provider.go`, `test_provider_scripted.go`, `test_provider_channel.go`, `test_provider_http.go`) currently live in `ratchetplugin/` not `provider/`. They need to be moved into the provider package and refactored to remove any ratchetplugin dependencies.

Review each test_provider file:
- `ratchetplugin/test_provider.go` → `provider/test_provider.go` — the TestProvider struct + NewTestProvider factory
- `ratchetplugin/test_provider_scripted.go` → `provider/test_provider_scripted.go`
- `ratchetplugin/test_provider_channel.go` → `provider/test_provider_channel.go`
- `ratchetplugin/test_provider_http.go` → `provider/test_provider_http.go`

Update the package declaration from `package ratchetplugin` to `package provider`.

**Step 3: Verify build**

```bash
cd /Users/jon/workspace/workflow-plugin-agent
GOPRIVATE=github.com/GoCodeAlone/* go build ./provider/...
```

**Step 4: Commit**

```bash
git add provider/
git commit -m "feat: extract provider package from ratchet — AI provider abstraction + implementations"
```

---

### Task 3: Extract agent and task types

**Files:**
- Create: `workflow-plugin-agent/agent/agent.go`
- Create: `workflow-plugin-agent/task/task.go`
- Create: `workflow-plugin-agent/tools/types.go`

**Step 1: Copy agent types**

```bash
mkdir -p /Users/jon/workspace/workflow-plugin-agent/agent
cp /Users/jon/workspace/ratchet/agent/agent.go /Users/jon/workspace/workflow-plugin-agent/agent/
```

Update module path in package. The agent package has no internal imports — it's standalone types (Status, Personality, Info).

**Step 2: Copy task types**

```bash
mkdir -p /Users/jon/workspace/workflow-plugin-agent/task
cp /Users/jon/workspace/ratchet/task/task.go /Users/jon/workspace/workflow-plugin-agent/task/
```

Same — standalone types (Status, Priority, Task).

**Step 3: Create tool types**

The current ratchet has `plugin/tool.go` with the `Tool` interface. Extract this as the canonical tool interface.

```go
// tools/types.go
package tools

import "context"

// ToolDef describes a tool's parameters using JSON Schema.
type ToolDef struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Parameters  any    `json:"parameters"` // JSON Schema object
}

// ToolCall represents a request to execute a tool.
type ToolCall struct {
	ID   string         `json:"id"`
	Name string         `json:"name"`
	Args map[string]any `json:"args"`
}

// ToolResult is the output of a tool execution.
type ToolResult struct {
	Content string `json:"content"`
	Error   string `json:"error,omitempty"`
}

// Tool is the interface that all agent tools must implement.
type Tool interface {
	Name() string
	Description() string
	Definition() ToolDef
	Execute(ctx context.Context, args map[string]any) (string, error)
}

// Registry manages tool registration and lookup.
type Registry struct {
	tools map[string]Tool
}

// NewRegistry creates a new tool registry.
func NewRegistry() *Registry {
	return &Registry{tools: make(map[string]Tool)}
}

// Register adds a tool to the registry.
func (r *Registry) Register(tool Tool) {
	r.tools[tool.Name()] = tool
}

// Get returns a tool by name.
func (r *Registry) Get(name string) (Tool, bool) {
	t, ok := r.tools[name]
	return t, ok
}

// All returns all registered tools.
func (r *Registry) All() []Tool {
	result := make([]Tool, 0, len(r.tools))
	for _, t := range r.tools {
		result = append(result, t)
	}
	return result
}

// Definitions returns ToolDefs for all registered tools.
func (r *Registry) Definitions() []ToolDef {
	defs := make([]ToolDef, 0, len(r.tools))
	for _, t := range r.tools {
		defs = append(defs, t.Definition())
	}
	return defs
}
```

**Step 4: Verify build**

```bash
cd /Users/jon/workspace/workflow-plugin-agent
GOPRIVATE=github.com/GoCodeAlone/* go build ./...
```

**Step 5: Commit**

```bash
git add agent/ task/ tools/
git commit -m "feat: extract agent, task, and tool types from ratchet"
```

---

### Task 4: Extract core agent execution engine

This is the most complex extraction. The `step_agent_execute.go` is tightly coupled to ratchet services. We need to define clean interfaces for the external dependencies, then extract the execution logic.

**Files:**
- Create: `workflow-plugin-agent/executor/executor.go` — core autonomous loop
- Create: `workflow-plugin-agent/executor/interfaces.go` — dependency interfaces
- Create: `workflow-plugin-agent/executor/loop_detector.go` — loop detection
- Create: `workflow-plugin-agent/executor/context_manager.go` — context window management

**Step 1: Define dependency interfaces**

The agent execution loop currently depends on these ratchet services. Define clean interfaces so the consuming app can provide its own implementations:

```go
// executor/interfaces.go
package executor

import "context"

// Approver handles approval requests during agent execution.
// Ratchet implements this with its ApprovalManager.
// Other apps can implement differently (e.g., Slack bot, CLI prompt).
type Approver interface {
	RequestApproval(ctx context.Context, action, reason string, details map[string]any) (string, error) // returns approval ID
	WaitForApproval(ctx context.Context, approvalID string, timeout time.Duration) (approved bool, comment string, err error)
}

// HumanRequester handles human-in-the-loop requests.
type HumanRequester interface {
	RequestHuman(ctx context.Context, reqType, title, description string, urgency string, blocking bool) (string, error)
	WaitForResponse(ctx context.Context, requestID string, timeout time.Duration) (response map[string]any, err error)
}

// SecretRedactor redacts sensitive values from text before sending to LLM.
type SecretRedactor interface {
	Redact(text string) string
}

// TranscriptRecorder records conversation history for debugging/audit.
type TranscriptRecorder interface {
	Record(ctx context.Context, agentID string, role string, content string, toolCalls []ToolCallRecord) error
}

// ToolCallRecord is a single tool call for transcript recording.
type ToolCallRecord struct {
	ID     string
	Name   string
	Args   string
	Result string
}

// MemoryStore provides semantic memory for agents.
type MemoryStore interface {
	Search(ctx context.Context, query string, limit int) ([]MemoryEntry, error)
	Save(ctx context.Context, content, category string, metadata map[string]string) error
	ExtractAndSave(ctx context.Context, agentID string, messages []Message) error
}

// MemoryEntry is a single memory record.
type MemoryEntry struct {
	Content   string
	Category  string
	Score     float64
	CreatedAt time.Time
}

// NullApprover is a no-op implementation (always auto-approves).
type NullApprover struct{}
func (n NullApprover) RequestApproval(ctx context.Context, action, reason string, details map[string]any) (string, error) { return "auto", nil }
func (n NullApprover) WaitForApproval(ctx context.Context, id string, timeout time.Duration) (bool, string, error) { return true, "auto-approved", nil }

// NullHumanRequester is a no-op implementation.
type NullHumanRequester struct{}
func (n NullHumanRequester) RequestHuman(ctx context.Context, reqType, title, desc, urgency string, blocking bool) (string, error) { return "", nil }
func (n NullHumanRequester) WaitForResponse(ctx context.Context, id string, timeout time.Duration) (map[string]any, error) { return nil, nil }

// NullRedactor is a no-op implementation (no redaction).
type NullRedactor struct{}
func (n NullRedactor) Redact(text string) string { return text }

// NullTranscript is a no-op implementation.
type NullTranscript struct{}
func (n NullTranscript) Record(ctx context.Context, agentID, role, content string, toolCalls []ToolCallRecord) error { return nil }

// NullMemory is a no-op implementation.
type NullMemory struct{}
func (n NullMemory) Search(ctx context.Context, query string, limit int) ([]MemoryEntry, error) { return nil, nil }
func (n NullMemory) Save(ctx context.Context, content, category string, metadata map[string]string) error { return nil }
func (n NullMemory) ExtractAndSave(ctx context.Context, agentID string, messages []Message) error { return nil }
```

**Step 2: Extract loop detector**

Copy `/Users/jon/workspace/ratchet/ratchetplugin/loop_detector.go` to `executor/loop_detector.go`. Update package to `executor`. This file has no internal dependencies — it's standalone logic.

**Step 3: Extract context manager**

Copy `/Users/jon/workspace/ratchet/ratchetplugin/context_manager.go` to `executor/context_manager.go`. Update package to `executor`. Review imports — it may reference provider types (update to use `../provider`).

**Step 4: Extract executor core**

Create `executor/executor.go` by refactoring `step_agent_execute.go`. The key change: instead of looking up services from `modular.Application`, accept them via a `Config` struct:

```go
// executor/executor.go
package executor

import (
	"context"
	"time"

	"github.com/GoCodeAlone/workflow-plugin-agent/provider"
	"github.com/GoCodeAlone/workflow-plugin-agent/tools"
)

// Config holds all dependencies for the agent executor.
type Config struct {
	Provider        provider.Provider
	ToolRegistry    *tools.Registry
	Approver        Approver
	HumanRequester  HumanRequester
	SecretRedactor  SecretRedactor
	Transcript      TranscriptRecorder
	Memory          MemoryStore
	MaxIterations   int
	ApprovalTimeout time.Duration
	RequestTimeout  time.Duration
	LoopDetection   LoopDetectorConfig
	Compaction      CompactionConfig
}

// CompactionConfig controls context window management.
type CompactionConfig struct {
	Threshold float64 // 0.0-1.0, compact at this % of context window
	MaxTokens int     // model's context window size
}

// Result is the output of an agent execution.
type Result struct {
	Content    string
	Iterations int
	LoopAbort  bool
}

// Execute runs the autonomous agent loop: LLM call → tool execution → repeat.
// This is the core observe→reason→act cycle.
func Execute(ctx context.Context, cfg Config, systemPrompt string, userTask string, agentID string) (*Result, error) {
	// ... refactored from step_agent_execute.go Execute() method
	// Key changes:
	// 1. Provider passed directly (not looked up from service registry)
	// 2. ToolRegistry passed directly
	// 3. Approver/HumanRequester/SecretRedactor/Transcript/Memory via interfaces
	// 4. All null-safe: if interface is nil, use Null* implementation
}
```

The actual implementation is a refactored copy of `step_agent_execute.go` lines 36-504, replacing:
- `app.GetService("ToolRegistry")` → `cfg.ToolRegistry`
- `app.GetService("ApprovalManager")` → `cfg.Approver`
- `app.GetService("SecretGuard")` → `cfg.SecretRedactor`
- `app.GetService("TranscriptRecorder")` → `cfg.Transcript`
- Memory searches → `cfg.Memory.Search()`
- Memory extraction → `cfg.Memory.ExtractAndSave()`

**Step 5: Verify build**

```bash
cd /Users/jon/workspace/workflow-plugin-agent
GOPRIVATE=github.com/GoCodeAlone/* go build ./...
```

**Step 6: Commit**

```bash
git add executor/
git commit -m "feat: extract agent execution engine with clean dependency interfaces"
```

---

### Task 5: Extract memory system

**Files:**
- Create: `workflow-plugin-agent/memory/memory.go` — SQLite FTS5 + embedding implementation
- Create: `workflow-plugin-agent/memory/extract.go` — auto-extract facts from conversations

**Step 1: Extract memory implementation**

The memory system currently lives in `ratchetplugin/tools/memory.go` (tool wrappers) and the actual storage is in the ratchet DB schema. Extract the storage logic into a standalone package that creates its own SQLite table.

```go
// memory/memory.go
package memory

import (
	"context"
	"database/sql"
	"time"

	"github.com/GoCodeAlone/workflow-plugin-agent/executor"
)

// SQLiteMemoryStore implements executor.MemoryStore using SQLite FTS5.
type SQLiteMemoryStore struct {
	db *sql.DB
}

// NewSQLiteMemoryStore creates a memory store, initializing the table if needed.
func NewSQLiteMemoryStore(db *sql.DB) (*SQLiteMemoryStore, error) {
	// Create memory_entries table + FTS5 virtual table
	// Same schema as ratchet's db.go memory tables
}

// Search performs hybrid search (FTS5 BM25 ranking).
func (s *SQLiteMemoryStore) Search(ctx context.Context, query string, limit int) ([]executor.MemoryEntry, error) {
	// FTS5 MATCH query with BM25 ranking
}

// Save stores a memory entry.
func (s *SQLiteMemoryStore) Save(ctx context.Context, content, category string, metadata map[string]string) error {
	// INSERT into memory_entries
}

// ExtractAndSave extracts key facts from a conversation and saves them.
func (s *SQLiteMemoryStore) ExtractAndSave(ctx context.Context, agentID string, messages []executor.Message) error {
	// Uses simple heuristics to extract facts (no LLM needed)
	// Saves each extracted fact
}
```

**Step 2: Verify build**

```bash
cd /Users/jon/workspace/workflow-plugin-agent
GOPRIVATE=github.com/GoCodeAlone/* go build ./...
```

**Step 3: Commit**

```bash
git add memory/
git commit -m "feat: extract SQLite FTS5 memory store from ratchet"
```

---

### Task 6: Create plugin registration (engine plugin interface)

**Files:**
- Modify: `workflow-plugin-agent/plugin.go` — register module types and step types

**Step 1: Implement EnginePlugin**

```go
// plugin.go
package agent

import (
	"github.com/GoCodeAlone/workflow/plugin"
	// internal packages
)

// Plugin is the workflow engine plugin for AI agent capabilities.
type Plugin struct{}

// New creates a new agent plugin instance.
func New() *Plugin {
	return &Plugin{}
}

func (p *Plugin) Name() string { return "agent" }

func (p *Plugin) ModuleFactories() map[string]plugin.ModuleFactory {
	return map[string]plugin.ModuleFactory{
		"agent.provider": newProviderModuleFactory(),
	}
}

func (p *Plugin) StepFactories() map[string]plugin.StepFactory {
	return map[string]plugin.StepFactory{
		"step.agent_execute":  newAgentExecuteStepFactory(),
		"step.provider_test":  newProviderTestStepFactory(),
		"step.provider_models": newProviderModelsStepFactory(),
	}
}

func (p *Plugin) WiringHooks() []plugin.WiringHook {
	return []plugin.WiringHook{
		providerRegistryHook(),
	}
}
```

**Step 2: Create module factory for agent.provider**

Refactor from `ratchetplugin/module_ai_provider.go`. The module factory creates provider instances (anthropic, openai, mock, test) from YAML config and registers them in the service registry.

**Step 3: Create step factory for step.agent_execute**

Refactor from `ratchetplugin/step_agent_execute.go` factory (lines 662-742). The step looks up the provider and tool registry from the service registry, builds an `executor.Config`, and calls `executor.Execute()`.

**Step 4: Verify build**

```bash
cd /Users/jon/workspace/workflow-plugin-agent
GOPRIVATE=github.com/GoCodeAlone/* go build ./...
```

**Step 5: Run tests**

```bash
GOPRIVATE=github.com/GoCodeAlone/* go test ./... -v -race
```

**Step 6: Commit and tag**

```bash
git add plugin.go modules/ steps/
git commit -m "feat: plugin registration — agent.provider module + step.agent_execute"
git tag v0.1.0
git push -u origin main --tags
```

---

## Phase 2: Refactor Ratchet to Consume Plugin

### Task 7: Update ratchet to import workflow-plugin-agent

**Files:**
- Modify: `/Users/jon/workspace/ratchet/go.mod`
- Modify: `/Users/jon/workspace/ratchet/cmd/ratchetd/main.go`
- Modify: `/Users/jon/workspace/ratchet/ratchetplugin/plugin.go`
- Modify: `/Users/jon/workspace/ratchet/ratchetplugin/step_agent_execute.go`

**Step 1: Add dependency**

```bash
cd /Users/jon/workspace/ratchet
GOPRIVATE=github.com/GoCodeAlone/* go get github.com/GoCodeAlone/workflow-plugin-agent@v0.1.0
```

**Step 2: Update server to load agent plugin**

In `cmd/ratchetd/main.go`, add the agent plugin:

```go
import (
	agent "github.com/GoCodeAlone/workflow-plugin-agent"
	// ... existing imports
)

// In main():
engine, err := workflow.NewEngineBuilder().
	WithAllDefaults().
	WithLogger(logger).
	WithPlugins(all.DefaultPlugins()...).
	WithPlugin(agent.New()).      // NEW: agent primitives
	WithPlugin(ratchetplugin.New()). // ratchet-specific features
	BuildFromConfig(cfg)
```

**Step 3: Remove duplicated code from ratchetplugin**

In `ratchetplugin/plugin.go`, remove the module/step registrations that are now provided by the agent plugin:
- Remove `"ratchet.ai_provider"` from ModuleFactories (now `"agent.provider"`)
- Remove `"step.agent_execute"` from StepFactories (now provided by agent plugin)
- Keep all other ratchet-specific factories

**Step 4: Update ratchet's step_agent_execute to delegate**

Replace the current `AgentExecuteStep.Execute()` with a thin wrapper that:
1. Looks up ratchet-specific services (ApprovalManager, SecretGuard, etc.)
2. Wraps them as `executor.Approver`, `executor.SecretRedactor`, etc.
3. Calls `executor.Execute()` from the agent plugin

OR — if the agent plugin's `step.agent_execute` handles service lookup generically (checking service registry for interfaces), ratchet just needs to register its managers under the right service names.

**Preferred approach**: The agent plugin's `step.agent_execute` looks up optional services by interface type from the service registry. Ratchet registers its managers under those service names. No wrapper needed.

In `ratchetplugin/plugin.go` wiring hooks, register ratchet's managers with the service names the agent plugin expects:
- `"agent.approver"` → ratchet's ApprovalManager (implements executor.Approver)
- `"agent.human_requester"` → ratchet's HumanRequestManager
- `"agent.secret_redactor"` → ratchet's SecretGuard
- `"agent.transcript"` → ratchet's TranscriptRecorder
- `"agent.memory"` → ratchet's memory store
- `"agent.tool_registry"` → ratchet's ToolRegistry

**Step 5: Update YAML configs**

In `config/modules.yaml`, change:
```yaml
# Before:
ratchet-ai:
  type: ratchet.ai_provider
  config: ...

# After:
ratchet-ai:
  type: agent.provider
  config: ...
```

**Step 6: Implement executor interfaces on ratchet managers**

Add interface implementation methods to ratchet's existing managers so they satisfy the executor interfaces:

- `ApprovalManager` needs `RequestApproval()` + `WaitForApproval()` matching executor.Approver
- `SecretGuard` needs `Redact()` matching executor.SecretRedactor
- `TranscriptRecorder` needs `Record()` matching executor.TranscriptRecorder
- `HumanRequestManager` needs methods matching executor.HumanRequester

Most of these already exist with compatible signatures — just verify and add thin adapter methods if needed.

**Step 7: Update provider imports**

Replace `"github.com/GoCodeAlone/ratchet/provider"` with `"github.com/GoCodeAlone/workflow-plugin-agent/provider"` throughout ratchetplugin where provider types are used.

**Step 8: Build and test**

```bash
cd /Users/jon/workspace/ratchet
GOPRIVATE=github.com/GoCodeAlone/* go build ./...
GOPRIVATE=github.com/GoCodeAlone/* go test ./... -v -race
```

**Step 9: Commit**

```bash
git add -A
git commit -m "refactor: import workflow-plugin-agent, remove duplicated AI primitives"
```

---

### Task 8: Verify existing functionality

**Step 1: Build and deploy to minikube**

```bash
cd /Users/jon/workspace/ratchet
# Cross-compile
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/ratchetd ./cmd/ratchetd
# Build Docker image
docker build -f Dockerfile.prebuilt -t ratchet-app:v15 .
# Load into minikube
minikube image load ratchet-app:v15
# Update deployment
kubectl set image deployment/ratchet ratchet=ratchet-app:v15
```

**Step 2: Run existing tests**

```bash
GOPRIVATE=github.com/GoCodeAlone/* go test ./... -v -race
```

**Step 3: QA with Playwright**

Verify the dashboard loads, agents list, tasks work, SSE events stream, provider test passes.

**Step 4: Commit and push**

```bash
git push origin main
```

---

## Phase 3: Self-Healing Infrastructure Use Case

### Task 9: Create k8s operations tools

**Files:**
- Create: `/Users/jon/workspace/ratchet/ratchetplugin/tools/k8s.go`

**Step 1: Implement k8s tools**

These tools shell out to `kubectl` (available in the container) for simplicity. In production, they'd use the k8s Go client.

```go
// ratchetplugin/tools/k8s.go
package tools

// K8sGetPodsTool — list pods with status, restarts, age
// K8sGetEventsTool — cluster events (warnings, errors)
// K8sGetLogsTool — container logs with tail/since
// K8sDescribeTool — describe any resource
// K8sRestartPodTool — delete pod to trigger restart (requires approval)
// K8sScaleTool — scale deployment replicas (requires approval)
// K8sRollbackTool — rollback deployment (requires approval)
// K8sApplyTool — apply manifest (requires approval)
// InfraHealthCheckTool — aggregate health score
```

Each tool follows the existing pattern in `ratchetplugin/tools/`:
- Implements `plugin.Tool` interface (Name, Description, Definition, Execute)
- Returns JSON-formatted results
- Destructive tools (restart, scale, rollback, apply) include a comment indicating they require approval

**Step 2: Register tools**

In `ratchetplugin/plugin.go` `toolRegistryHook()`, register the new k8s tools alongside existing tools.

**Step 3: Build and test**

```bash
cd /Users/jon/workspace/ratchet
GOPRIVATE=github.com/GoCodeAlone/* go build ./...
```

**Step 4: Commit**

```bash
git add ratchetplugin/tools/k8s.go
git commit -m "feat: add k8s operations tools for self-healing infrastructure"
```

---

### Task 10: Create infrastructure skills

**Files:**
- Create: `/Users/jon/workspace/ratchet/skills/self-healing-infrastructure.md`
- Create: `/Users/jon/workspace/ratchet/skills/deployment-orchestrator.md`
- Create: `/Users/jon/workspace/ratchet/skills/incident-manager.md`

**Step 1: Write self-healing infrastructure skill**

```markdown
---
name: self-healing-infrastructure
description: Autonomous infrastructure monitoring, anomaly detection, and remediation
required_tools: [k8s_get_pods, k8s_get_events, k8s_get_logs, k8s_restart_pod, k8s_scale, memory_search, memory_save, request_approval]
---

# Self-Healing Infrastructure Agent

You are an autonomous infrastructure agent responsible for monitoring, detecting anomalies, and remediating issues.

## Observation Phase
1. Check pod health: `k8s_get_pods` — look for CrashLoopBackOff, OOMKilled, high restart counts
2. Check events: `k8s_get_events` — look for warnings, failed scheduling, image pull errors
3. Search memory: `memory_search` — check for known issues and past remediation outcomes

## Detection Phase
Classify severity:
- **Critical**: >50% pods down, all replicas crashing
- **High**: Key service degraded, repeated restarts (>5 in 10 min)
- **Medium**: Single pod crash, resource pressure
- **Low**: Transient error, self-resolved

## Remediation Phase
For each detected issue, attempt the least invasive fix first:
1. Single pod crash → restart pod (`k8s_restart_pod`)
2. Multiple pods crashing → check logs for root cause, then restart or rollback
3. Resource exhaustion → scale up (`k8s_scale`, requires approval)
4. Bad deployment → rollback (`k8s_rollback`, requires approval)

## Safety Constraints
- NEVER delete PersistentVolumeClaims
- NEVER scale to 0 replicas without explicit approval
- ALWAYS request approval for rollbacks and scaling changes
- ALWAYS save outcomes to memory after remediation

## Learning Phase
After every remediation attempt:
1. Save outcome: `memory_save` with category "remediation" and success/failure status
2. If failed: escalate to human via `request_approval` with full context
3. If succeeded: update memory with the successful pattern
```

**Step 2: Write deployment orchestrator skill**

Similar structure: risk assessment → deployment window selection → canary monitoring → rollback decision.

**Step 3: Write incident manager skill**

Incident lifecycle: create → investigate → remediate → resolve → postmortem.

**Step 4: Commit**

```bash
git add skills/
git commit -m "feat: add infrastructure skills — self-healing, deployment, incident management"
```

---

### Task 11: Create infrastructure monitoring pipeline

**Files:**
- Create: `/Users/jon/workspace/ratchet/config/pipelines-infra.yaml`
- Modify: `/Users/jon/workspace/ratchet/config/triggers.yaml`

**Step 1: Create monitoring pipeline**

```yaml
# config/pipelines-infra.yaml
pipelines:
  infra-monitor:
    description: "Periodic infrastructure health check with autonomous remediation"
    steps:
      - name: find-infra-agent
        type: step.db_query
        config:
          db: ratchet-db
          query: "SELECT id, name, system_prompt FROM agents WHERE role = 'infrastructure' AND status != 'stopped' LIMIT 1"
          mode: single

      - name: check-agent-exists
        type: step.conditional
        config:
          field: "{{ index .steps \"find-infra-agent\" \"id\" | default \"\" }}"
          routes:
            "": skip-execution
          default: execute-agent

      - name: execute-agent
        type: step.agent_execute
        config:
          max_iterations: 15
          provider_service: ratchet-ai
          approval_timeout: "10m"
          loop_detection:
            max_consecutive: 3
            max_errors: 2
        input:
          agent_id: "{{ index .steps \"find-infra-agent\" \"id\" }}"
          task: "Run infrastructure health check. Observe pod health, detect anomalies, and remediate if needed. Record all findings."

      - name: skip-execution
        type: step.json_response
        config:
          status: 200
          body:
            message: "No infrastructure agent configured"
```

**Step 2: Add cron trigger**

In `config/triggers.yaml`, add:

```yaml
triggers:
  infra-health-check:
    type: schedule
    config:
      schedule: "*/5 * * * *"  # Every 5 minutes
      pipeline: infra-monitor
```

**Step 3: Import the new config file**

In `ratchet.yaml`, add `config/pipelines-infra.yaml` to the imports list.

**Step 4: Commit**

```bash
git add config/pipelines-infra.yaml config/triggers.yaml ratchet.yaml
git commit -m "feat: add infrastructure monitoring pipeline with 5-minute cron trigger"
```

---

## Phase 4: Testing Infrastructure

### Task 12: Create test scenarios for agent plugin

**Files:**
- Create: `/Users/jon/workspace/workflow-scenarios/scenarios/43-agent-plugin-basic/`
- Create: `/Users/jon/workspace/workflow-scenarios/scenarios/44-agent-self-healing/`

**Step 1: Scenario 43 — Basic agent plugin integration test (Layer 1: Simple mocks)**

Create a minimal workflow config that uses `agent.provider` (mock mode) and `step.agent_execute` to verify the plugin plumbing works. The mock provider returns a scripted "I'm done" response (no tool calls).

Tests:
- Agent executes and returns result
- Provider module initializes
- Tool registry is available
- Memory search/save works
- Context compaction triggers at threshold

**Step 2: Scenario 44 — Self-healing infrastructure (Layer 2: Scripted scenarios)**

Create a workflow config with:
- `agent.provider` in test/scripted mode
- Scripted responses that simulate: check pods → detect CrashLoopBackOff → restart pod → verify health → save to memory
- Mock k8s tools that return deterministic data

Tests:
- Full observe→detect→remediate→validate→learn cycle completes
- Approval gate fires for destructive operations
- Memory save is called after remediation
- Loop detection triggers if agent gets stuck

**Step 3: Scenario 45 — Operator mode (Layer 3: Live operator)**

Create a workflow config with:
- `agent.provider` in test/http mode
- Claude sub-agents act as the LLM, sending tool call responses via HTTP

This scenario is run manually (not in CI) and validates the full interactive experience.

**Step 4: Deploy and run scenarios**

```bash
cd /Users/jon/workspace/workflow-scenarios
# Deploy scenarios 43-44
./deploy.sh 43 44
# Run API tests
go test ./scenarios/43-agent-plugin-basic/... -v
go test ./scenarios/44-agent-self-healing/... -v
```

**Step 5: Commit**

```bash
cd /Users/jon/workspace/workflow-scenarios
git add scenarios/43-agent-plugin-basic/ scenarios/44-agent-self-healing/
git commit -m "test: add agent plugin scenarios — basic mock + self-healing scripted"
```

---

## Summary of Deliverables

| Phase | Task | Output |
|-------|------|--------|
| 1 | Tasks 1-6 | `workflow-plugin-agent` repo v0.1.0 with provider, executor, memory, tools packages |
| 2 | Tasks 7-8 | Ratchet refactored to consume plugin, existing functionality verified |
| 3 | Tasks 9-11 | K8s tools, infrastructure skills, monitoring pipeline |
| 4 | Task 12 | 3 test scenarios (basic mock, scripted self-healing, operator mode) |
