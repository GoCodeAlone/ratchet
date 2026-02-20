package ratchetplugin

import (
	"context"
	"fmt"
	"sync"

	"github.com/GoCodeAlone/ratchet/plugin"
	"github.com/GoCodeAlone/ratchet/provider"
)

// ToolRegistry merges built-in tools and MCP tools into a unified registry.
type ToolRegistry struct {
	mu    sync.RWMutex
	tools map[string]plugin.Tool
}

func NewToolRegistry() *ToolRegistry {
	return &ToolRegistry{
		tools: make(map[string]plugin.Tool),
	}
}

// Register adds a tool to the registry.
func (tr *ToolRegistry) Register(tool plugin.Tool) {
	tr.mu.Lock()
	defer tr.mu.Unlock()
	tr.tools[tool.Name()] = tool
}

// RegisterMCP registers MCP tools with a server-prefixed name.
func (tr *ToolRegistry) RegisterMCP(serverName string, tools []plugin.Tool) {
	tr.mu.Lock()
	defer tr.mu.Unlock()
	for _, t := range tools {
		name := "mcp_" + serverName + "__" + t.Name()
		tr.tools[name] = t
	}
}

// Get returns a tool by name.
func (tr *ToolRegistry) Get(name string) (plugin.Tool, bool) {
	tr.mu.RLock()
	defer tr.mu.RUnlock()
	t, ok := tr.tools[name]
	return t, ok
}

// AllDefs returns tool definitions for all registered tools.
func (tr *ToolRegistry) AllDefs() []provider.ToolDef {
	tr.mu.RLock()
	defer tr.mu.RUnlock()
	defs := make([]provider.ToolDef, 0, len(tr.tools))
	for _, t := range tr.tools {
		defs = append(defs, t.Definition())
	}
	return defs
}

// Execute runs a tool by name with the given arguments.
func (tr *ToolRegistry) Execute(ctx context.Context, name string, args map[string]any) (any, error) {
	tr.mu.RLock()
	t, ok := tr.tools[name]
	tr.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("tool %q not found in registry", name)
	}
	return t.Execute(ctx, args)
}

// Names returns all registered tool names.
func (tr *ToolRegistry) Names() []string {
	tr.mu.RLock()
	defer tr.mu.RUnlock()
	names := make([]string, 0, len(tr.tools))
	for name := range tr.tools {
		names = append(names, name)
	}
	return names
}
