package ratchetplugin

import (
	"context"
	"fmt"
	"sync"
	"time"

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
	name       string
	provider   provider.Provider
	agents     []AgentSeed
	logger     modular.Logger
	httpSource *HTTPSource // non-nil when test provider is in HTTP mode
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

// TestHTTPSource returns the HTTPSource if the provider is a test provider in HTTP mode.
func (m *AIProviderModule) TestHTTPSource() *HTTPSource { return m.httpSource }

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
		var httpSource *HTTPSource // non-nil when test provider uses HTTP mode
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
		case "test":
			testMode, _ := cfg["test_mode"].(string)
			if testMode == "" {
				testMode = "scripted"
			}
			var source ResponseSource
			switch testMode {
			case "scripted":
				var steps []ScriptedStep
				// Try loading from scenario_file first
				if scenarioFile, ok := cfg["scenario_file"].(string); ok && scenarioFile != "" {
					scenario, err := LoadScenario(scenarioFile)
					if err != nil {
						p = &mockProvider{responses: []string{fmt.Sprintf("Failed to load scenario: %v", err)}}
						break
					}
					source = NewScriptedSourceFromScenario(scenario)
				} else {
					// Parse inline steps from config
					if raw, ok := cfg["steps"]; ok {
						if list, ok := raw.([]any); ok {
							for _, item := range list {
								if m, ok := item.(map[string]any); ok {
									step := ScriptedStep{}
									step.Content, _ = m["content"].(string)
									step.Error, _ = m["error"].(string)
									// Parse tool_calls from config
									if tcRaw, ok := m["tool_calls"]; ok {
										if tcList, ok := tcRaw.([]any); ok {
											for _, tcItem := range tcList {
												if tcMap, ok := tcItem.(map[string]any); ok {
													tc := provider.ToolCall{}
													tc.ID, _ = tcMap["id"].(string)
													tc.Name, _ = tcMap["name"].(string)
													if args, ok := tcMap["arguments"].(map[string]any); ok {
														tc.Arguments = args
													}
													step.ToolCalls = append(step.ToolCalls, tc)
												}
											}
										}
									}
									steps = append(steps, step)
								}
							}
						}
					}
					if len(steps) == 0 {
						steps = []ScriptedStep{{Content: "Test provider: no steps configured."}}
					}
					loop := false
					if v, ok := cfg["loop"].(bool); ok {
						loop = v
					}
					source = NewScriptedSource(steps, loop)
				}
			case "channel":
				// Channel mode — source is created but channels are only useful in-process
				channelSource, _, _ := NewChannelSource()
				source = channelSource
			case "http":
				httpSource = NewHTTPSource(nil) // SSE hub wired later via wiring hook
				source = httpSource
			default:
				p = &mockProvider{responses: []string{fmt.Sprintf("Unknown test_mode %q", testMode)}}
			}
			if source != nil {
				var opts []TestProviderOption
				if timeoutStr, ok := cfg["timeout"].(string); ok && timeoutStr != "" {
					if d, err := time.ParseDuration(timeoutStr); err == nil {
						opts = append(opts, WithTimeout(d))
					}
				}
				p = NewTestProvider(source, opts...)
			}
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
			name:       name,
			provider:   p,
			agents:     agents,
			httpSource: httpSource,
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
