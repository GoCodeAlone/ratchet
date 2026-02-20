// Package anthropic provides an AI provider backed by the Anthropic Messages API.
package anthropic

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/GoCodeAlone/ratchet/provider"
)

const (
	defaultModel   = "claude-opus-4-6"
	apiURL         = "https://api.anthropic.com/v1/messages"
	anthropicVersion = "2023-06-01"
)

// Provider is an Anthropic Claude AI provider.
type Provider struct {
	apiKey  string
	model   string
	client  *http.Client
}

// New creates an Anthropic provider with the given API key and model.
// If model is empty, defaults to claude-opus-4-6.
func New(apiKey, model string) *Provider {
	if model == "" {
		model = defaultModel
	}
	return &Provider{
		apiKey: apiKey,
		model:  model,
		client: &http.Client{},
	}
}

// Name returns the provider identifier.
func (p *Provider) Name() string { return "anthropic" }

// --- Anthropic API request/response types ---

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"input_schema"`
}

type anthropicRequest struct {
	Model     string             `json:"model"`
	MaxTokens int                `json:"max_tokens"`
	System    string             `json:"system,omitempty"`
	Messages  []anthropicMessage `json:"messages"`
	Tools     []anthropicTool    `json:"tools,omitempty"`
	Stream    bool               `json:"stream,omitempty"`
}

type anthropicContentBlock struct {
	Type  string         `json:"type"`
	Text  string         `json:"text,omitempty"`
	ID    string         `json:"id,omitempty"`
	Name  string         `json:"name,omitempty"`
	Input map[string]any `json:"input,omitempty"`
}

type anthropicUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

type anthropicResponse struct {
	ID      string                  `json:"id"`
	Type    string                  `json:"type"`
	Role    string                  `json:"role"`
	Content []anthropicContentBlock `json:"content"`
	Model   string                  `json:"model"`
	Usage   anthropicUsage          `json:"usage"`
	Error   *anthropicError         `json:"error,omitempty"`
}

type anthropicError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

// buildRequest converts provider types into an Anthropic API request.
func (p *Provider) buildRequest(messages []provider.Message, tools []provider.ToolDef, stream bool) *anthropicRequest {
	req := &anthropicRequest{
		Model:     p.model,
		MaxTokens: 4096,
		Stream:    stream,
	}

	// Extract system message and user/assistant turns
	for _, m := range messages {
		if m.Role == provider.RoleSystem {
			req.System = m.Content
		} else {
			role := string(m.Role)
			req.Messages = append(req.Messages, anthropicMessage{Role: role, Content: m.Content})
		}
	}

	// Convert tools
	for _, t := range tools {
		schema := t.Parameters
		if schema == nil {
			schema = map[string]any{"type": "object", "properties": map[string]any{}}
		}
		req.Tools = append(req.Tools, anthropicTool{
			Name:        t.Name,
			Description: t.Description,
			InputSchema: schema,
		})
	}
	return req
}

// Chat sends a non-streaming request and returns the complete response.
func (p *Provider) Chat(ctx context.Context, messages []provider.Message, tools []provider.ToolDef) (*provider.Response, error) {
	req := p.buildRequest(messages, tools, false)
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("anthropic: marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("anthropic: build request: %w", err)
	}
	p.setHeaders(httpReq)

	httpResp, err := p.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("anthropic: http: %w", err)
	}
	defer httpResp.Body.Close()

	respBody, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return nil, fmt.Errorf("anthropic: read response: %w", err)
	}

	var ar anthropicResponse
	if err := json.Unmarshal(respBody, &ar); err != nil {
		return nil, fmt.Errorf("anthropic: decode response: %w", err)
	}
	if ar.Error != nil {
		return nil, fmt.Errorf("anthropic API error: %s: %s", ar.Error.Type, ar.Error.Message)
	}
	if httpResp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("anthropic: unexpected status %d: %s", httpResp.StatusCode, string(respBody))
	}

	return p.convertResponse(&ar), nil
}

func (p *Provider) convertResponse(ar *anthropicResponse) *provider.Response {
	resp := &provider.Response{
		Usage: provider.Usage{
			InputTokens:  ar.Usage.InputTokens,
			OutputTokens: ar.Usage.OutputTokens,
		},
	}
	for _, block := range ar.Content {
		switch block.Type {
		case "text":
			resp.Content += block.Text
		case "tool_use":
			resp.ToolCalls = append(resp.ToolCalls, provider.ToolCall{
				ID:        block.ID,
				Name:      block.Name,
				Arguments: block.Input,
			})
		}
	}
	return resp
}

func (p *Provider) setHeaders(req *http.Request) {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", p.apiKey)
	req.Header.Set("anthropic-version", anthropicVersion)
}

// Stream sends a streaming request and emits events on the returned channel.
func (p *Provider) Stream(ctx context.Context, messages []provider.Message, tools []provider.ToolDef) (<-chan provider.StreamEvent, error) {
	req := p.buildRequest(messages, tools, true)
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("anthropic: marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("anthropic: build request: %w", err)
	}
	p.setHeaders(httpReq)
	httpReq.Header.Set("Accept", "text/event-stream")

	httpResp, err := p.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("anthropic: http: %w", err)
	}
	if httpResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(httpResp.Body)
		httpResp.Body.Close()
		return nil, fmt.Errorf("anthropic: unexpected status %d: %s", httpResp.StatusCode, string(body))
	}

	ch := make(chan provider.StreamEvent, 64)
	go func() {
		defer close(ch)
		defer httpResp.Body.Close()
		p.parseSSE(httpResp.Body, ch)
	}()
	return ch, nil
}

// SSE event types from Anthropic streaming
type sseEvent struct {
	Type  string `json:"type"`
	Index int    `json:"index"`
	Delta struct {
		Type        string `json:"type"`
		Text        string `json:"text"`
		PartialJSON string `json:"partial_json"`
	} `json:"delta"`
	ContentBlock struct {
		Type  string `json:"type"`
		ID    string `json:"id"`
		Name  string `json:"name"`
		Input string `json:"input"`
	} `json:"content_block"`
	Usage *anthropicUsage `json:"usage,omitempty"`
	Error *anthropicError `json:"error,omitempty"`
}

func (p *Provider) parseSSE(body io.Reader, ch chan<- provider.StreamEvent) {
	scanner := bufio.NewScanner(body)
	var eventType string
	// Track partial tool call accumulation
	toolInputs := map[int]string{}
	toolIDs := map[int]string{}
	toolNames := map[int]string{}

	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "event: ") {
			eventType = strings.TrimPrefix(line, "event: ")
			continue
		}
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var ev sseEvent
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			ch <- provider.StreamEvent{Type: "error", Error: fmt.Sprintf("parse SSE: %v", err)}
			return
		}

		switch eventType {
		case "content_block_start":
			if ev.ContentBlock.Type == "tool_use" {
				toolIDs[ev.Index] = ev.ContentBlock.ID
				toolNames[ev.Index] = ev.ContentBlock.Name
				toolInputs[ev.Index] = ""
			}
		case "content_block_delta":
			switch ev.Delta.Type {
			case "text_delta":
				ch <- provider.StreamEvent{Type: "text", Text: ev.Delta.Text}
			case "input_json_delta":
				toolInputs[ev.Index] += ev.Delta.PartialJSON
			}
		case "content_block_stop":
			// Emit completed tool call if any
			if name, ok := toolNames[ev.Index]; ok {
				var args map[string]any
				_ = json.Unmarshal([]byte(toolInputs[ev.Index]), &args)
				ch <- provider.StreamEvent{
					Type: "tool_call",
					Tool: &provider.ToolCall{
						ID:        toolIDs[ev.Index],
						Name:      name,
						Arguments: args,
					},
				}
				delete(toolIDs, ev.Index)
				delete(toolNames, ev.Index)
				delete(toolInputs, ev.Index)
			}
		case "message_delta":
			if ev.Usage != nil {
				ch <- provider.StreamEvent{
					Type:  "done",
					Usage: &provider.Usage{InputTokens: ev.Usage.InputTokens, OutputTokens: ev.Usage.OutputTokens},
				}
			}
		case "error":
			if ev.Error != nil {
				ch <- provider.StreamEvent{Type: "error", Error: fmt.Sprintf("%s: %s", ev.Error.Type, ev.Error.Message)}
			}
		}
	}
	if err := scanner.Err(); err != nil {
		ch <- provider.StreamEvent{Type: "error", Error: fmt.Sprintf("read stream: %v", err)}
	}
}
