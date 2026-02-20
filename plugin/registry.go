package plugin

import (
	"fmt"
	"sync"
)

// InMemoryRegistry manages plugin lifecycle in memory.
type InMemoryRegistry struct {
	mu      sync.RWMutex
	plugins map[string]Plugin
}

// NewRegistry creates an empty InMemoryRegistry.
func NewRegistry() *InMemoryRegistry {
	return &InMemoryRegistry{plugins: make(map[string]Plugin)}
}

// Register adds a plugin to the registry.
// Returns an error if a plugin with the same name is already registered.
func (r *InMemoryRegistry) Register(p Plugin) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.plugins[p.Name()]; exists {
		return fmt.Errorf("plugin %q already registered", p.Name())
	}
	r.plugins[p.Name()] = p
	return nil
}

// Get returns a plugin by name.
func (r *InMemoryRegistry) Get(name string) (Plugin, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.plugins[name]
	return p, ok
}

// List returns all registered plugins.
func (r *InMemoryRegistry) List() []Plugin {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]Plugin, 0, len(r.plugins))
	for _, p := range r.plugins {
		result = append(result, p)
	}
	return result
}

// Unregister removes a plugin by name.
func (r *InMemoryRegistry) Unregister(name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.plugins[name]; !exists {
		return fmt.Errorf("plugin %q not found", name)
	}
	delete(r.plugins, name)
	return nil
}
