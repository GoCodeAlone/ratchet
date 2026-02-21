package provider

import (
	"context"
	"fmt"
)

// CopilotConfig holds configuration for the GitHub Copilot provider.
type CopilotConfig struct {
	Token string
	Model string
}

// CopilotProvider implements Provider as a stub for the GitHub Copilot API.
type CopilotProvider struct {
	config CopilotConfig
}

// NewCopilotProvider creates a new Copilot provider stub.
func NewCopilotProvider(cfg CopilotConfig) *CopilotProvider {
	return &CopilotProvider{config: cfg}
}

func (p *CopilotProvider) Name() string { return "copilot" }

func (p *CopilotProvider) Chat(_ context.Context, _ []Message, _ []ToolDef) (*Response, error) {
	return nil, fmt.Errorf("copilot: provider not yet implemented")
}

func (p *CopilotProvider) Stream(_ context.Context, _ []Message, _ []ToolDef) (<-chan StreamEvent, error) {
	return nil, fmt.Errorf("copilot: provider not yet implemented")
}
