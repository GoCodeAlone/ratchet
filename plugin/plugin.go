// Package plugin defines the Ratchet plugin system for extending agent capabilities.
package plugin

import (
	"context"

	"github.com/GoCodeAlone/ratchet/provider"
)

// Plugin extends Ratchet with additional tools, providers, or capabilities.
type Plugin interface {
	// Name returns the unique plugin identifier.
	Name() string

	// Version returns the plugin version (semver).
	Version() string

	// Description returns a human-readable description.
	Description() string

	// Tools returns the tools this plugin provides to agents.
	Tools() []provider.ToolDef

	// Execute runs a tool by name with the given arguments.
	Execute(ctx context.Context, toolName string, args map[string]any) (any, error)

	// OnLoad is called when the plugin is loaded. Use ctx for shared resources.
	OnLoad(ctx PluginContext) error

	// OnUnload is called when the plugin is being removed.
	OnUnload() error
}

// PluginContext provides shared resources to plugins during loading.
type PluginContext struct {
	DataDir string // persistent storage directory for the plugin
}

// Registry manages plugin lifecycle and discovery.
type Registry interface {
	// Register adds a plugin to the registry.
	Register(p Plugin) error

	// Get returns a plugin by name.
	Get(name string) (Plugin, bool)

	// List returns all registered plugins.
	List() []Plugin

	// Unregister removes a plugin by name.
	Unregister(name string) error
}
