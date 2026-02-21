package provider

import (
	"context"
	"fmt"
	"net/http"
)

const (
	defaultOpenAIBaseURL = "https://api.openai.com"
	defaultOpenAIModel   = "gpt-4o"
)

// OpenAIConfig holds configuration for the OpenAI provider.
type OpenAIConfig struct {
	APIKey     string
	Model      string
	BaseURL    string
	MaxTokens  int
	HTTPClient *http.Client
}

// OpenAIProvider implements Provider as a stub for the OpenAI Chat Completions API.
type OpenAIProvider struct {
	config OpenAIConfig
}

// NewOpenAIProvider creates a new OpenAI provider stub.
func NewOpenAIProvider(cfg OpenAIConfig) *OpenAIProvider {
	if cfg.Model == "" {
		cfg.Model = defaultOpenAIModel
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = defaultOpenAIBaseURL
	}
	return &OpenAIProvider{config: cfg}
}

func (p *OpenAIProvider) Name() string { return "openai" }

func (p *OpenAIProvider) Chat(_ context.Context, _ []Message, _ []ToolDef) (*Response, error) {
	return nil, fmt.Errorf("openai: provider not yet implemented")
}

func (p *OpenAIProvider) Stream(_ context.Context, _ []Message, _ []ToolDef) (<-chan StreamEvent, error) {
	return nil, fmt.Errorf("openai: provider not yet implemented")
}
