// Package openai provides an AI provider backed by the OpenAI Chat Completions API.
package openai

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
	defaultModel = "gpt-4o"
	apiURL       = "https://api.openai.com/v1/chat/completions"
)

// Provider is an OpenAI Chat Completions AI provider.
type Provider struct {
	apiKey string
	model  string
	client *http.Client
}

// New creates an OpenAI provider with the given API key and model.
// If model is empty, defaults to gpt-4o.
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
func (p *Provider) Name() string { return "openai" }

// --- OpenAI API request/response types ---

type openAIMessage struct {
	Role       string          `json:"role"`
	Content    string          `json:"content,omitempty"`
	ToolCallID string          `json:"tool_call_id,omitempty"`
	ToolCalls  []openAIToolCall `json:"tool_calls,omitempty"`
}

type openAIFunction struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Parameters  map[string]any `json:"parameters"`
}

type openAITool struct {
	Type     string         `json:"type"` // "function"
	Function openAIFunction `json:"function"`
}

type openAIToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"` // "function"
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"` // JSON string
	} `json:"function"`
}

type openAIRequest struct {
	Model    string          `json:"model"`
	Messages []openAIMessage `json:"messages"`
	Tools    []openAITool    `json:"tools,omitempty"`
	Stream   bool            `json:"stream,omitempty"`
}

type openAIChoice struct {
	Index        int           `json:"index"`
	Message      openAIMessage `json:"message"`
	Delta        openAIMessage `json:"delta"`
	FinishReason string        `json:"finish_reason"`
}

type openAIUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
}

type openAIResponse struct {
	ID      string        `json:"id"`
	Object  string        `json:"object"`
	Model   string        `json:"model"`
	Choices []openAIChoice `json:"choices"`
	Usage   openAIUsage   `json:"usage"`
	Error   *openAIError  `json:"error,omitempty"`
}

type openAIError struct {
	Message string `json:"message"`
	Type    string `json:"type"`
	Code    string `json:"code"`
}

func (p *Provider) buildRequest(messages []provider.Message, tools []provider.ToolDef, stream bool) *openAIRequest {
	req := &openAIRequest{
		Model:  p.model,
		Stream: stream,
	}
	for _, m := range messages {
		req.Messages = append(req.Messages, openAIMessage{
			Role:       string(m.Role),
			Content:    m.Content,
			ToolCallID: m.ToolCallID,
		})
	}
	for _, t := range tools {
		params := t.Parameters
		if params == nil {
			params = map[string]any{"type": "object", "properties": map[string]any{}}
		}
		req.Tools = append(req.Tools, openAITool{
			Type: "function",
			Function: openAIFunction{
				Name:        t.Name,
				Description: t.Description,
				Parameters:  params,
			},
		})
	}
	return req
}

func (p *Provider) setHeaders(req *http.Request) {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.apiKey)
}

// Chat sends a non-streaming request and returns the complete response.
func (p *Provider) Chat(ctx context.Context, messages []provider.Message, tools []provider.ToolDef) (*provider.Response, error) {
	req := p.buildRequest(messages, tools, false)
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("openai: marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("openai: build request: %w", err)
	}
	p.setHeaders(httpReq)

	httpResp, err := p.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("openai: http: %w", err)
	}
	defer httpResp.Body.Close()

	respBody, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return nil, fmt.Errorf("openai: read response: %w", err)
	}

	var or openAIResponse
	if err := json.Unmarshal(respBody, &or); err != nil {
		return nil, fmt.Errorf("openai: decode response: %w", err)
	}
	if or.Error != nil {
		return nil, fmt.Errorf("openai API error: %s: %s", or.Error.Type, or.Error.Message)
	}
	if httpResp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("openai: unexpected status %d: %s", httpResp.StatusCode, string(respBody))
	}

	return p.convertResponse(&or), nil
}

func (p *Provider) convertResponse(or *openAIResponse) *provider.Response {
	resp := &provider.Response{
		Usage: provider.Usage{
			InputTokens:  or.Usage.PromptTokens,
			OutputTokens: or.Usage.CompletionTokens,
		},
	}
	if len(or.Choices) == 0 {
		return resp
	}
	msg := or.Choices[0].Message
	resp.Content = msg.Content
	for _, tc := range msg.ToolCalls {
		var args map[string]any
		_ = json.Unmarshal([]byte(tc.Function.Arguments), &args)
		resp.ToolCalls = append(resp.ToolCalls, provider.ToolCall{
			ID:        tc.ID,
			Name:      tc.Function.Name,
			Arguments: args,
		})
	}
	return resp
}

// Stream sends a streaming request and emits events on the returned channel.
func (p *Provider) Stream(ctx context.Context, messages []provider.Message, tools []provider.ToolDef) (<-chan provider.StreamEvent, error) {
	req := p.buildRequest(messages, tools, true)
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("openai: marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("openai: build request: %w", err)
	}
	p.setHeaders(httpReq)
	httpReq.Header.Set("Accept", "text/event-stream")

	httpResp, err := p.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("openai: http: %w", err)
	}
	if httpResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(httpResp.Body)
		httpResp.Body.Close()
		return nil, fmt.Errorf("openai: unexpected status %d: %s", httpResp.StatusCode, string(body))
	}

	ch := make(chan provider.StreamEvent, 64)
	go func() {
		defer close(ch)
		defer httpResp.Body.Close()
		p.parseSSE(httpResp.Body, ch)
	}()
	return ch, nil
}

type streamChunk struct {
	ID      string         `json:"id"`
	Object  string         `json:"object"`
	Model   string         `json:"model"`
	Choices []openAIChoice `json:"choices"`
	Usage   *openAIUsage   `json:"usage,omitempty"`
}

func (p *Provider) parseSSE(body io.Reader, ch chan<- provider.StreamEvent) {
	scanner := bufio.NewScanner(body)
	// Accumulate tool call arguments per index
	toolArgs := map[int]string{}
	toolIDs := map[int]string{}
	toolNames := map[int]string{}

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			ch <- provider.StreamEvent{Type: "done"}
			return
		}

		var chunk streamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			ch <- provider.StreamEvent{Type: "error", Error: fmt.Sprintf("parse SSE: %v", err)}
			return
		}

		for _, choice := range chunk.Choices {
			delta := choice.Delta
			if delta.Content != "" {
				ch <- provider.StreamEvent{Type: "text", Text: delta.Content}
			}
			for _, tc := range delta.ToolCalls {
				idx := 0
				// OpenAI streams tool calls with an index field in tool_calls
				if tc.ID != "" {
					toolIDs[idx] = tc.ID
				}
				if tc.Function.Name != "" {
					toolNames[idx] = tc.Function.Name
				}
				toolArgs[idx] += tc.Function.Arguments
			}
			if choice.FinishReason == "tool_calls" {
				for idx, name := range toolNames {
					var args map[string]any
					_ = json.Unmarshal([]byte(toolArgs[idx]), &args)
					ch <- provider.StreamEvent{
						Type: "tool_call",
						Tool: &provider.ToolCall{
							ID:        toolIDs[idx],
							Name:      name,
							Arguments: args,
						},
					}
				}
				toolArgs = map[int]string{}
				toolIDs = map[int]string{}
				toolNames = map[int]string{}
			}
		}
	}
	if err := scanner.Err(); err != nil {
		ch <- provider.StreamEvent{Type: "error", Error: fmt.Sprintf("read stream: %v", err)}
	}
}
