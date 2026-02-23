package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAnthropicChat(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify headers
		if r.Header.Get("x-api-key") != "test-key" {
			t.Errorf("expected x-api-key=test-key, got %s", r.Header.Get("x-api-key"))
		}
		if r.Header.Get("anthropic-version") != "2023-06-01" {
			t.Errorf("expected anthropic-version=2023-06-01, got %s", r.Header.Get("anthropic-version"))
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("expected Content-Type=application/json, got %s", r.Header.Get("Content-Type"))
		}

		// Verify request body
		var req anthropicRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if req.Model != "claude-sonnet-4-20250514" {
			t.Errorf("expected model claude-sonnet-4-20250514, got %s", req.Model)
		}
		if req.System != "You are helpful." {
			t.Errorf("expected system prompt, got %q", req.System)
		}
		if len(req.Messages) != 1 {
			t.Fatalf("expected 1 message, got %d", len(req.Messages))
		}

		// Return response
		resp := anthropicResponse{
			ID:   "msg_123",
			Type: "message",
			Content: []anthropicRespItem{
				{Type: "text", Text: "Hello! How can I help?"},
			},
			Usage: anthropicUsage{InputTokens: 15, OutputTokens: 8},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	p := NewAnthropicProvider(AnthropicConfig{
		APIKey:  "test-key",
		BaseURL: server.URL,
	})

	resp, err := p.Chat(context.Background(), []Message{
		{Role: RoleSystem, Content: "You are helpful."},
		{Role: RoleUser, Content: "Hello"},
	}, nil)
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}

	if resp.Content != "Hello! How can I help?" {
		t.Errorf("expected content %q, got %q", "Hello! How can I help?", resp.Content)
	}
	if resp.Usage.InputTokens != 15 {
		t.Errorf("expected 15 input tokens, got %d", resp.Usage.InputTokens)
	}
	if resp.Usage.OutputTokens != 8 {
		t.Errorf("expected 8 output tokens, got %d", resp.Usage.OutputTokens)
	}
}

func TestAnthropicChatWithTools(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req anthropicRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}

		if len(req.Tools) != 1 {
			t.Fatalf("expected 1 tool, got %d", len(req.Tools))
		}
		if req.Tools[0].Name != "read_file" {
			t.Errorf("expected tool name read_file, got %s", req.Tools[0].Name)
		}

		resp := anthropicResponse{
			ID:   "msg_456",
			Type: "message",
			Content: []anthropicRespItem{
				{Type: "text", Text: "Let me read that file."},
				{
					Type:  "tool_use",
					ID:    "toolu_abc",
					Name:  "read_file",
					Input: map[string]any{"path": "/tmp/test.txt"},
				},
			},
			Usage: anthropicUsage{InputTokens: 20, OutputTokens: 15},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	p := NewAnthropicProvider(AnthropicConfig{
		APIKey:  "test-key",
		BaseURL: server.URL,
	})

	resp, err := p.Chat(context.Background(), []Message{
		{Role: RoleUser, Content: "Read /tmp/test.txt"},
	}, []ToolDef{
		{
			Name:        "read_file",
			Description: "Read a file",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path": map[string]any{"type": "string"},
				},
				"required": []string{"path"},
			},
		},
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}

	if resp.Content != "Let me read that file." {
		t.Errorf("expected text content, got %q", resp.Content)
	}
	if len(resp.ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(resp.ToolCalls))
	}
	tc := resp.ToolCalls[0]
	if tc.ID != "toolu_abc" {
		t.Errorf("expected tool call ID toolu_abc, got %s", tc.ID)
	}
	if tc.Name != "read_file" {
		t.Errorf("expected tool call name read_file, got %s", tc.Name)
	}
	if tc.Arguments["path"] != "/tmp/test.txt" {
		t.Errorf("expected path /tmp/test.txt, got %v", tc.Arguments["path"])
	}
}

func TestAnthropicChatToolResult(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req anthropicRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}

		// Verify tool result is sent as user message with tool_result content
		found := false
		for _, msg := range req.Messages {
			if msg.Role == "user" {
				if content, ok := msg.Content.([]any); ok {
					for _, c := range content {
						if cm, ok := c.(map[string]any); ok {
							if cm["type"] == "tool_result" {
								found = true
							}
						}
					}
				}
			}
		}
		if !found {
			t.Error("expected tool_result content block in messages")
		}

		resp := anthropicResponse{
			ID:   "msg_789",
			Type: "message",
			Content: []anthropicRespItem{
				{Type: "text", Text: "The file contains: hello world"},
			},
			Usage: anthropicUsage{InputTokens: 25, OutputTokens: 10},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	p := NewAnthropicProvider(AnthropicConfig{
		APIKey:  "test-key",
		BaseURL: server.URL,
	})

	resp, err := p.Chat(context.Background(), []Message{
		{Role: RoleUser, Content: "Read /tmp/test.txt"},
		{Role: RoleAssistant, Content: "Let me read that file."},
		{Role: RoleTool, Content: "hello world", ToolCallID: "toolu_abc"},
	}, nil)
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}

	if resp.Content != "The file contains: hello world" {
		t.Errorf("expected response content, got %q", resp.Content)
	}
}

func TestAnthropicChatAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = fmt.Fprint(w, `{"error":{"type":"authentication_error","message":"invalid x-api-key"}}`)
	}))
	defer server.Close()

	p := NewAnthropicProvider(AnthropicConfig{
		APIKey:  "bad-key",
		BaseURL: server.URL,
	})

	_, err := p.Chat(context.Background(), []Message{
		{Role: RoleUser, Content: "Hello"},
	}, nil)
	if err == nil {
		t.Fatal("expected error for 401 response")
	}
	if !contains(err.Error(), "401") {
		t.Errorf("expected error to mention 401, got: %v", err)
	}
}

func TestAnthropicStream(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req anthropicRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if !req.Stream {
			t.Error("expected stream=true in request")
		}

		w.Header().Set("Content-Type", "text/event-stream")
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("expected response writer to support flushing")
		}

		events := []string{
			`{"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}`,
			`{"type":"content_block_start","index":0,"content_block":{"type":"text"}}`,
			`{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}`,
			`{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}`,
			`{"type":"content_block_stop","index":0}`,
			`{"type":"message_delta","usage":{"output_tokens":5}}`,
			`{"type":"message_stop"}`,
		}

		for _, e := range events {
			_, _ = fmt.Fprintf(w, "data: %s\n\n", e)
			flusher.Flush()
		}
	}))
	defer server.Close()

	p := NewAnthropicProvider(AnthropicConfig{
		APIKey:  "test-key",
		BaseURL: server.URL,
	})

	ch, err := p.Stream(context.Background(), []Message{
		{Role: RoleUser, Content: "Hello"},
	}, nil)
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}

	var texts []string
	var done bool
	for event := range ch {
		switch event.Type {
		case "text":
			texts = append(texts, event.Text)
		case "done":
			done = true
			if event.Usage == nil {
				t.Error("expected usage in done event")
			}
		case "error":
			t.Fatalf("unexpected error: %s", event.Error)
		}
	}

	if !done {
		t.Error("expected done event")
	}
	combined := ""
	for _, s := range texts {
		combined += s
	}
	if combined != "Hello world" {
		t.Errorf("expected 'Hello world', got %q", combined)
	}
}

func TestAnthropicStreamWithToolCall(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("expected response writer to support flushing")
		}

		events := []string{
			`{"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}`,
			`{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_123","name":"read_file"}}`,
			`{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"path\":"}}`,
			`{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\"/tmp/f.txt\"}"}}`,
			`{"type":"content_block_stop","index":0}`,
			`{"type":"message_stop"}`,
		}

		for _, e := range events {
			_, _ = fmt.Fprintf(w, "data: %s\n\n", e)
			flusher.Flush()
		}
	}))
	defer server.Close()

	p := NewAnthropicProvider(AnthropicConfig{
		APIKey:  "test-key",
		BaseURL: server.URL,
	})

	ch, err := p.Stream(context.Background(), []Message{
		{Role: RoleUser, Content: "Read file"},
	}, nil)
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}

	var toolEvent *StreamEvent
	for event := range ch {
		if event.Type == "tool_call" {
			e := event
			toolEvent = &e
		}
	}

	if toolEvent == nil {
		t.Fatal("expected tool_call event")
	}
	if toolEvent.Tool.ID != "toolu_123" {
		t.Errorf("expected tool ID toolu_123, got %s", toolEvent.Tool.ID)
	}
	if toolEvent.Tool.Name != "read_file" {
		t.Errorf("expected tool name read_file, got %s", toolEvent.Tool.Name)
	}
	if toolEvent.Tool.Arguments["path"] != "/tmp/f.txt" {
		t.Errorf("expected path /tmp/f.txt, got %v", toolEvent.Tool.Arguments["path"])
	}
}

func TestAnthropicProviderName(t *testing.T) {
	p := NewAnthropicProvider(AnthropicConfig{})
	if p.Name() != "anthropic" {
		t.Errorf("expected name 'anthropic', got %q", p.Name())
	}
}

func TestAnthropicDefaults(t *testing.T) {
	p := NewAnthropicProvider(AnthropicConfig{})
	if p.config.Model != defaultAnthropicModel {
		t.Errorf("expected default model %s, got %s", defaultAnthropicModel, p.config.Model)
	}
	if p.config.BaseURL != defaultAnthropicBaseURL {
		t.Errorf("expected default base URL %s, got %s", defaultAnthropicBaseURL, p.config.BaseURL)
	}
	if p.config.MaxTokens != defaultAnthropicMaxTokens {
		t.Errorf("expected default max tokens %d, got %d", defaultAnthropicMaxTokens, p.config.MaxTokens)
	}
}
