package ratchetplugin

import (
	"context"
	"fmt"
	"sync"

	"github.com/CrisisTextLine/modular"
	"github.com/GoCodeAlone/ratchet/provider"
	"github.com/GoCodeAlone/workflow/plugin"
)

// AgentSeed holds the definition of an agent to seed into the database.
type AgentSeed struct {
	ID           string `yaml:"id"`
	Name         string `yaml:"name"`
	Role         string `yaml:"role"`
	SystemPrompt string `yaml:"system_prompt"`
	Provider     string `yaml:"provider"`
	Model        string `yaml:"model"`
	TeamID       string `yaml:"team_id"`
	IsLead       bool   `yaml:"is_lead"`
}

// AIProviderModule wraps an AI provider.Provider as a modular.Module.
// It registers itself in the service registry so steps can look it up by name.
type AIProviderModule struct {
	name     string
	provider provider.Provider
	agents   []AgentSeed
	logger   modular.Logger
}

// Name implements modular.Module.
func (m *AIProviderModule) Name() string { return m.name }

// Init registers this module as a named service.
func (m *AIProviderModule) Init(app modular.Application) error {
	return app.RegisterService(m.name, m)
}

// ProvidesServices declares the provider service.
func (m *AIProviderModule) ProvidesServices() []modular.ServiceProvider {
	return []modular.ServiceProvider{
		{
			Name:        m.name,
			Description: "Ratchet AI provider: " + m.name,
			Instance:    m,
		},
	}
}

// RequiresServices declares no dependencies.
func (m *AIProviderModule) RequiresServices() []modular.ServiceDependency {
	return nil
}

// Start implements modular.Startable (no-op).
func (m *AIProviderModule) Start(_ context.Context) error { return nil }

// Stop implements modular.Stoppable (no-op).
func (m *AIProviderModule) Stop(_ context.Context) error { return nil }

// Provider returns the underlying AI provider.
func (m *AIProviderModule) Provider() provider.Provider { return m.provider }

// Agents returns the agent seeds configured for this provider module.
func (m *AIProviderModule) Agents() []AgentSeed { return m.agents }

// newAIProviderFactory returns a plugin.ModuleFactory for "ratchet.ai_provider".
func newAIProviderFactory() plugin.ModuleFactory {
	return func(name string, cfg map[string]any) modular.Module {
		providerType, _ := cfg["provider"].(string)
		if providerType == "" {
			providerType = "mock"
		}
		model, _ := cfg["model"].(string)
		_ = model // used when constructing real providers

		// Build AI provider
		var p provider.Provider
		switch providerType {
		case "mock":
			var responses []string
			if raw, ok := cfg["responses"]; ok {
				if list, ok := raw.([]any); ok {
					for _, item := range list {
						if s, ok := item.(string); ok {
							responses = append(responses, s)
						}
					}
				}
			}
			if len(responses) == 0 {
				responses = []string{"I have completed the task."}
			}
			p = &mockProvider{responses: responses}
		default:
			// Fall back to mock for unknown provider types
			p = &mockProvider{responses: []string{fmt.Sprintf("Provider %q not configured, using stub.", providerType)}}
		}

		// Parse agent seeds
		var agents []AgentSeed
		if raw, ok := cfg["agents"]; ok {
			if list, ok := raw.([]any); ok {
				for _, item := range list {
					if m, ok := item.(map[string]any); ok {
						agents = append(agents, extractAgentSeed(m))
					}
				}
			}
		}

		return &AIProviderModule{
			name:     name,
			provider: p,
			agents:   agents,
		}
	}
}

// mockProvider is a simple scripted AI provider for testing and demos.
type mockProvider struct {
	responses []string
	idx       int
	mu        sync.Mutex
}

func (m *mockProvider) Name() string { return "mock" }

func (m *mockProvider) Chat(_ context.Context, _ []provider.Message, _ []provider.ToolDef) (*provider.Response, error) {
	m.mu.Lock()
	resp := m.responses[m.idx%len(m.responses)]
	m.idx++
	m.mu.Unlock()
	return &provider.Response{
		Content: resp,
		Usage:   provider.Usage{InputTokens: 10, OutputTokens: len(resp)},
	}, nil
}

func (m *mockProvider) Stream(ctx context.Context, messages []provider.Message, tools []provider.ToolDef) (<-chan provider.StreamEvent, error) {
	resp, err := m.Chat(ctx, messages, tools)
	if err != nil {
		return nil, err
	}
	ch := make(chan provider.StreamEvent, 2)
	ch <- provider.StreamEvent{Type: "text", Text: resp.Content}
	ch <- provider.StreamEvent{Type: "done", Usage: &resp.Usage}
	close(ch)
	return ch, nil
}
