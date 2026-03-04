package ratchetplugin

import (
	"context"

	agentplugin "github.com/GoCodeAlone/workflow-plugin-agent"
	agentprovider "github.com/GoCodeAlone/workflow-plugin-agent/provider"
	"github.com/GoCodeAlone/ratchet/provider"
)

// agentProviderAdapter wraps a workflow-plugin-agent provider.Provider and
// adapts it to satisfy ratchet's provider.Provider interface.
// The two interfaces are structurally identical but use different package types.
type agentProviderAdapter struct {
	inner agentprovider.Provider
}

// agentProviderToRatchet returns a ratchet provider.Provider that wraps the
// underlying provider from an agentplugin.ProviderModule. Returns nil if the
// module has no provider.
func agentProviderToRatchet(mod *agentplugin.ProviderModule) provider.Provider {
	if mod == nil {
		return nil
	}
	inner := mod.Provider()
	if inner == nil {
		return nil
	}
	return &agentProviderAdapter{inner: inner}
}

func (a *agentProviderAdapter) Name() string { return a.inner.Name() }

func (a *agentProviderAdapter) Chat(ctx context.Context, messages []provider.Message, tools []provider.ToolDef) (*provider.Response, error) {
	agentMsgs := make([]agentprovider.Message, len(messages))
	for i, m := range messages {
		agentMsgs[i] = agentprovider.Message{
			Role:       agentprovider.Role(m.Role),
			Content:    m.Content,
			ToolCallID: m.ToolCallID,
			ToolCalls:  convertToolCallsToAgent(m.ToolCalls),
		}
	}

	agentTools := make([]agentprovider.ToolDef, len(tools))
	for i, t := range tools {
		agentTools[i] = agentprovider.ToolDef{
			Name:        t.Name,
			Description: t.Description,
			Parameters:  t.Parameters,
		}
	}

	resp, err := a.inner.Chat(ctx, agentMsgs, agentTools)
	if err != nil {
		return nil, err
	}

	return &provider.Response{
		Content:   resp.Content,
		ToolCalls: convertToolCallsFromAgent(resp.ToolCalls),
		Usage: provider.Usage{
			InputTokens:  resp.Usage.InputTokens,
			OutputTokens: resp.Usage.OutputTokens,
		},
	}, nil
}

func (a *agentProviderAdapter) Stream(ctx context.Context, messages []provider.Message, tools []provider.ToolDef) (<-chan provider.StreamEvent, error) {
	agentMsgs := make([]agentprovider.Message, len(messages))
	for i, m := range messages {
		agentMsgs[i] = agentprovider.Message{
			Role:       agentprovider.Role(m.Role),
			Content:    m.Content,
			ToolCallID: m.ToolCallID,
			ToolCalls:  convertToolCallsToAgent(m.ToolCalls),
		}
	}

	agentTools := make([]agentprovider.ToolDef, len(tools))
	for i, t := range tools {
		agentTools[i] = agentprovider.ToolDef{
			Name:        t.Name,
			Description: t.Description,
			Parameters:  t.Parameters,
		}
	}

	agentCh, err := a.inner.Stream(ctx, agentMsgs, agentTools)
	if err != nil {
		return nil, err
	}

	ch := make(chan provider.StreamEvent, 16)
	go func() {
		defer close(ch)
		for ev := range agentCh {
			out := provider.StreamEvent{
				Type:  ev.Type,
				Text:  ev.Text,
				Error: ev.Error,
			}
			if ev.Tool != nil {
				tc := provider.ToolCall{
					ID:        ev.Tool.ID,
					Name:      ev.Tool.Name,
					Arguments: ev.Tool.Arguments,
				}
				out.Tool = &tc
			}
			if ev.Usage != nil {
				u := provider.Usage{
					InputTokens:  ev.Usage.InputTokens,
					OutputTokens: ev.Usage.OutputTokens,
				}
				out.Usage = &u
			}
			ch <- out
		}
	}()
	return ch, nil
}

// convertToolCallsToAgent converts ratchet ToolCalls to agent plugin ToolCalls.
func convertToolCallsToAgent(tcs []provider.ToolCall) []agentprovider.ToolCall {
	if len(tcs) == 0 {
		return nil
	}
	result := make([]agentprovider.ToolCall, len(tcs))
	for i, tc := range tcs {
		result[i] = agentprovider.ToolCall{
			ID:        tc.ID,
			Name:      tc.Name,
			Arguments: tc.Arguments,
		}
	}
	return result
}

// convertToolCallsFromAgent converts agent plugin ToolCalls to ratchet ToolCalls.
func convertToolCallsFromAgent(tcs []agentprovider.ToolCall) []provider.ToolCall {
	if len(tcs) == 0 {
		return nil
	}
	result := make([]provider.ToolCall, len(tcs))
	for i, tc := range tcs {
		result[i] = provider.ToolCall{
			ID:        tc.ID,
			Name:      tc.Name,
			Arguments: tc.Arguments,
		}
	}
	return result
}
