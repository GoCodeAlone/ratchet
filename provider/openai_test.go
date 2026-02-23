package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOpenAIChat(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify headers
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("expected Authorization=Bearer test-key, got %s", r.Header.Get("Authorization"))
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("expected Content-Type=application/json, got %s", r.Header.Get("Content-Type"))
		}

		// Verify request body
		var req openaiRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if req.Model != "gpt-4o" {
			t.Errorf("expected model gpt-4o, got %s", req.Model)
		}
		if len(req.Messages) != 2 {
			t.Fatalf("expected 2 messages, got %d", len(req.Messages))
		}
		if req.Messages[0].Role != "system" {
			t.Errorf("expected first message role=system, got %s", req.Messages[0].Role)
		}
		if req.Messages[0].Content != "You are helpful." {
			t.Errorf("expected system content, got %q", req.Messages[0].Content)
		}
		if req.Messages[1].Role != "user" {
			t.Errorf("expected second message role=user, got %s", req.Messages[1].Role)
		}

		// Return response
		resp := openaiResponse{
			ID: "chatcmpl-123",
			Choices: []openaiChoice{
				{
					Message: openaiMessage{
						Role:    "assistant",
						Content: "Hello! How can I help?",
					},
					FinishReason: "stop",
				},
			},
			Usage: openaiUsage{PromptTokens: 15, CompletionTokens: 8},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	p := NewOpenAIProvider(OpenAIConfig{
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

func TestOpenAIChatWithTools(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req openaiRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}

		if len(req.Tools) != 1 {
			t.Fatalf("expected 1 tool, got %d", len(req.Tools))
		}
		if req.Tools[0].Type != "function" {
			t.Errorf("expected tool type=function, got %s", req.Tools[0].Type)
		}
		if req.Tools[0].Function.Name != "read_file" {
			t.Errorf("expected tool name read_file, got %s", req.Tools[0].Function.Name)
		}

		resp := openaiResponse{
			ID: "chatcmpl-456",
			Choices: []openaiChoice{
				{
					Message: openaiMessage{
						Role:    "assistant",
						Content: "Let me read that file.",
						ToolCalls: []openaiToolCall{
							{
								ID:   "call_abc",
								Type: "function",
								Function: openaiToolCallFunc{
									Name:      "read_file",
									Arguments: `{"path":"/tmp/test.txt"}`,
								},
							},
						},
					},
					FinishReason: "tool_calls",
				},
			},
			Usage: openaiUsage{PromptTokens: 20, CompletionTokens: 15},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	p := NewOpenAIProvider(OpenAIConfig{
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
	if tc.ID != "call_abc" {
		t.Errorf("expected tool call ID call_abc, got %s", tc.ID)
	}
	if tc.Name != "read_file" {
		t.Errorf("expected tool call name read_file, got %s", tc.Name)
	}
	if tc.Arguments["path"] != "/tmp/test.txt" {
		t.Errorf("expected path /tmp/test.txt, got %v", tc.Arguments["path"])
	}
}

func TestOpenAIChatToolResult(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req openaiRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}

		// Verify tool result is sent as role=tool message with tool_call_id
		found := false
		for _, msg := range req.Messages {
			if msg.Role == "tool" && msg.ToolCallID == "call_abc" && msg.Content == "hello world" {
				found = true
			}
		}
		if !found {
			t.Error("expected tool message with role=tool and tool_call_id=call_abc")
		}

		resp := openaiResponse{
			ID: "chatcmpl-789",
			Choices: []openaiChoice{
				{
					Message: openaiMessage{
						Role:    "assistant",
						Content: "The file contains: hello world",
					},
					FinishReason: "stop",
				},
			},
			Usage: openaiUsage{PromptTokens: 25, CompletionTokens: 10},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	p := NewOpenAIProvider(OpenAIConfig{
		APIKey:  "test-key",
		BaseURL: server.URL,
	})

	resp, err := p.Chat(context.Background(), []Message{
		{Role: RoleUser, Content: "Read /tmp/test.txt"},
		{Role: RoleAssistant, Content: "Let me read that file."},
		{Role: RoleTool, Content: "hello world", ToolCallID: "call_abc"},
	}, nil)
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}

	if resp.Content != "The file contains: hello world" {
		t.Errorf("expected response content, got %q", resp.Content)
	}
}

func TestOpenAIChatAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = fmt.Fprint(w, `{"error":{"type":"invalid_request_error","message":"Incorrect API key provided"}}`)
	}))
	defer server.Close()

	p := NewOpenAIProvider(OpenAIConfig{
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

func TestOpenAIStream(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req openaiRequest
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

		helloContent := "Hello"
		worldContent := " world"
		var emptyFinish = "stop"

		chunks := []openaiStreamChunk{
			{
				ID: "chatcmpl-stream1",
				Choices: []openaiStreamChoice{
					{Index: 0, Delta: openaiStreamDelta{Content: &helloContent}},
				},
			},
			{
				ID: "chatcmpl-stream1",
				Choices: []openaiStreamChoice{
					{Index: 0, Delta: openaiStreamDelta{Content: &worldContent}},
				},
			},
			{
				ID: "chatcmpl-stream1",
				Choices: []openaiStreamChoice{
					{Index: 0, Delta: openaiStreamDelta{}, FinishReason: &emptyFinish},
				},
				Usage: &openaiUsage{PromptTokens: 10, CompletionTokens: 5},
			},
		}

		for _, chunk := range chunks {
			data, _ := json.Marshal(chunk)
			_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
		_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
		flusher.Flush()
	}))
	defer server.Close()

	p := NewOpenAIProvider(OpenAIConfig{
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
			} else {
				if event.Usage.InputTokens != 10 {
					t.Errorf("expected 10 input tokens, got %d", event.Usage.InputTokens)
				}
				if event.Usage.OutputTokens != 5 {
					t.Errorf("expected 5 output tokens, got %d", event.Usage.OutputTokens)
				}
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

func TestOpenAIStreamWithToolCall(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("expected response writer to support flushing")
		}

		// Simulate OpenAI streaming tool call format:
		// First chunk has the tool call ID and name, subsequent chunks accumulate arguments
		toolCallsStart := []openaiStreamToolCall{
			{
				Index: 0,
				ID:    "call_xyz",
				Type:  "function",
				Function: openaiStreamFunc{
					Name:      "read_file",
					Arguments: "",
				},
			},
		}
		toolCallsArg1 := []openaiStreamToolCall{
			{
				Index: 0,
				Function: openaiStreamFunc{
					Arguments: `{"path":`,
				},
			},
		}
		toolCallsArg2 := []openaiStreamToolCall{
			{
				Index: 0,
				Function: openaiStreamFunc{
					Arguments: `"/tmp/f.txt"}`,
				},
			},
		}
		toolCallsFinish := "tool_calls"

		chunks := []openaiStreamChunk{
			{
				ID: "chatcmpl-tool1",
				Choices: []openaiStreamChoice{
					{Index: 0, Delta: openaiStreamDelta{ToolCalls: toolCallsStart}},
				},
			},
			{
				ID: "chatcmpl-tool1",
				Choices: []openaiStreamChoice{
					{Index: 0, Delta: openaiStreamDelta{ToolCalls: toolCallsArg1}},
				},
			},
			{
				ID: "chatcmpl-tool1",
				Choices: []openaiStreamChoice{
					{Index: 0, Delta: openaiStreamDelta{ToolCalls: toolCallsArg2}},
				},
			},
			{
				ID: "chatcmpl-tool1",
				Choices: []openaiStreamChoice{
					{Index: 0, Delta: openaiStreamDelta{}, FinishReason: &toolCallsFinish},
				},
			},
		}

		for _, chunk := range chunks {
			data, _ := json.Marshal(chunk)
			_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
		_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
		flusher.Flush()
	}))
	defer server.Close()

	p := NewOpenAIProvider(OpenAIConfig{
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
	if toolEvent.Tool.ID != "call_xyz" {
		t.Errorf("expected tool ID call_xyz, got %s", toolEvent.Tool.ID)
	}
	if toolEvent.Tool.Name != "read_file" {
		t.Errorf("expected tool name read_file, got %s", toolEvent.Tool.Name)
	}
	if toolEvent.Tool.Arguments["path"] != "/tmp/f.txt" {
		t.Errorf("expected path /tmp/f.txt, got %v", toolEvent.Tool.Arguments["path"])
	}
}

func TestOpenAIProviderName(t *testing.T) {
	p := NewOpenAIProvider(OpenAIConfig{})
	if p.Name() != "openai" {
		t.Errorf("expected name 'openai', got %q", p.Name())
	}
}

func TestOpenAIDefaults(t *testing.T) {
	p := NewOpenAIProvider(OpenAIConfig{})
	if p.config.Model != defaultOpenAIModel {
		t.Errorf("expected default model %s, got %s", defaultOpenAIModel, p.config.Model)
	}
	if p.config.BaseURL != defaultOpenAIBaseURL {
		t.Errorf("expected default base URL %s, got %s", defaultOpenAIBaseURL, p.config.BaseURL)
	}
	if p.config.MaxTokens != defaultOpenAIMaxTokens {
		t.Errorf("expected default max tokens %d, got %d", defaultOpenAIMaxTokens, p.config.MaxTokens)
	}
}
