// Package mock provides a scripted AI provider for testing.
package mock

import (
	"context"
	"fmt"

	"github.com/GoCodeAlone/ratchet/provider"
)

const defaultResponse = "Task acknowledged. Working on it."

// MockProvider implements provider.Provider for testing.
// It returns scripted responses and can simulate tool calls.
type MockProvider struct {
	responses []string
	idx       int
}

// New creates a MockProvider that cycles through the given responses.
func New(responses ...string) *MockProvider {
	return &MockProvider{responses: responses}
}

// Name returns the provider identifier.
func (m *MockProvider) Name() string { return "mock" }

// Chat returns the next scripted response, cycling through the queue.
func (m *MockProvider) Chat(_ context.Context, _ []provider.Message, _ []provider.ToolDef) (*provider.Response, error) {
	if len(m.responses) == 0 {
		return &provider.Response{Content: defaultResponse}, nil
	}
	resp := m.responses[m.idx%len(m.responses)]
	m.idx++
	return &provider.Response{Content: resp}, nil
}

// Stream sends a streaming response by wrapping Chat output into events.
func (m *MockProvider) Stream(ctx context.Context, messages []provider.Message, tools []provider.ToolDef) (<-chan provider.StreamEvent, error) {
	resp, err := m.Chat(ctx, messages, tools)
	if err != nil {
		return nil, fmt.Errorf("mock stream: %w", err)
	}

	ch := make(chan provider.StreamEvent, 3)
	go func() {
		defer close(ch)
		ch <- provider.StreamEvent{Type: "text", Text: resp.Content}
		ch <- provider.StreamEvent{
			Type:  "done",
			Usage: &provider.Usage{InputTokens: 0, OutputTokens: len(resp.Content)},
		}
	}()
	return ch, nil
}
