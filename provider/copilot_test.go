package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCopilotChat(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify headers
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("expected Authorization=Bearer test-token, got %s", r.Header.Get("Authorization"))
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("expected Content-Type=application/json, got %s", r.Header.Get("Content-Type"))
		}
		if r.Header.Get("Copilot-Integration-Id") != copilotIntegrationID {
			t.Errorf("expected Copilot-Integration-Id=%s, got %s", copilotIntegrationID, r.Header.Get("Copilot-Integration-Id"))
		}

		// Verify request body
		var req copilotRequest
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

		// Return response
		content := "Hello! How can I help?"
		resp := copilotResponse{
			ID: "chatcmpl-123",
			Choices: []copilotChoice{
				{
					Index:   0,
					Message: copilotResMsg{Role: "assistant", Content: &content},
				},
			},
			Usage: copilotUsage{PromptTokens: 15, CompletionTokens: 8, TotalTokens: 23},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	p := NewCopilotProvider(CopilotConfig{
		Token:   "test-token",
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

func TestCopilotChatWithTools(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req copilotRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}

		if len(req.Tools) != 1 {
			t.Fatalf("expected 1 tool, got %d", len(req.Tools))
		}
		if req.Tools[0].Function.Name != "read_file" {
			t.Errorf("expected tool name read_file, got %s", req.Tools[0].Function.Name)
		}
		if req.Tools[0].Type != "function" {
			t.Errorf("expected tool type function, got %s", req.Tools[0].Type)
		}

		content := "Let me read that file."
		resp := copilotResponse{
			ID: "chatcmpl-456",
			Choices: []copilotChoice{
				{
					Index: 0,
					Message: copilotResMsg{
						Role:    "assistant",
						Content: &content,
						ToolCalls: []copilotResToolCall{
							{
								ID:   "call_abc",
								Type: "function",
								Function: struct {
									Name      string `json:"name"`
									Arguments string `json:"arguments"`
								}{
									Name:      "read_file",
									Arguments: `{"path":"/tmp/test.txt"}`,
								},
							},
						},
					},
				},
			},
			Usage: copilotUsage{PromptTokens: 20, CompletionTokens: 15},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	p := NewCopilotProvider(CopilotConfig{
		Token:   "test-token",
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

func TestCopilotChatToolResult(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req copilotRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}

		// Verify tool result message is sent with tool_call_id
		found := false
		for _, msg := range req.Messages {
			if msg.Role == "tool" && msg.ToolCallID == "call_abc" {
				found = true
			}
		}
		if !found {
			t.Error("expected tool result message with tool_call_id")
		}

		// Verify assistant message includes tool_calls
		for _, msg := range req.Messages {
			if msg.Role != "assistant" || msg.ToolCalls == nil {
				continue
			}
			var tcs []copilotReqToolCall
			if err := json.Unmarshal(msg.ToolCalls, &tcs); err != nil {
				t.Errorf("decode assistant tool_calls: %v", err)
				continue
			}
			if len(tcs) == 0 || tcs[0].ID != "call_abc" {
				t.Errorf("expected assistant tool_calls[0].id=call_abc, got %+v", tcs)
			}
		}

		content := "The file contains: hello world"
		resp := copilotResponse{
			ID: "chatcmpl-789",
			Choices: []copilotChoice{
				{
					Index:   0,
					Message: copilotResMsg{Role: "assistant", Content: &content},
				},
			},
			Usage: copilotUsage{PromptTokens: 25, CompletionTokens: 10},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	p := NewCopilotProvider(CopilotConfig{
		Token:   "test-token",
		BaseURL: server.URL,
	})

	resp, err := p.Chat(context.Background(), []Message{
		{Role: RoleUser, Content: "Read /tmp/test.txt"},
		{Role: RoleAssistant, Content: "Let me read that file.", ToolCalls: []ToolCall{
			{ID: "call_abc", Name: "read_file", Arguments: map[string]any{"path": "/tmp/test.txt"}},
		}},
		{Role: RoleTool, Content: "hello world", ToolCallID: "call_abc"},
	}, nil)
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}

	if resp.Content != "The file contains: hello world" {
		t.Errorf("expected response content, got %q", resp.Content)
	}
}

func TestCopilotChatAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = fmt.Fprint(w, `{"error":{"type":"authentication_error","message":"invalid token"}}`)
	}))
	defer server.Close()

	p := NewCopilotProvider(CopilotConfig{
		Token:   "bad-token",
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

func TestCopilotStream(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req copilotRequest
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

		hello := "Hello"
		world := " world"
		events := []string{
			`{"id":"chatcmpl-1","choices":[{"index":0,"delta":{"role":"assistant","content":""}}],"usage":{"prompt_tokens":10,"completion_tokens":0}}`,
			fmt.Sprintf(`{"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":%q}}]}`, hello),
			fmt.Sprintf(`{"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":%q}}]}`, world),
			`{"id":"chatcmpl-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}`,
		}

		for _, e := range events {
			_, _ = fmt.Fprintf(w, "data: %s\n\n", e)
			flusher.Flush()
		}
		_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
		flusher.Flush()
	}))
	defer server.Close()

	p := NewCopilotProvider(CopilotConfig{
		Token:   "test-token",
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
			} else if event.Usage.InputTokens != 10 {
				t.Errorf("expected 10 input tokens, got %d", event.Usage.InputTokens)
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

func TestCopilotStreamWithToolCall(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("expected response writer to support flushing")
		}

		events := []string{
			`{"id":"chatcmpl-2","choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"id":"call_123","type":"function","function":{"name":"read_file","arguments":""}}]}}]}`,
			`{"id":"chatcmpl-2","choices":[{"index":0,"delta":{"tool_calls":[{"id":"","type":"function","function":{"name":"","arguments":"{\"path\":"}}]}}]}`,
			`{"id":"chatcmpl-2","choices":[{"index":0,"delta":{"tool_calls":[{"id":"","type":"function","function":{"name":"","arguments":"\"/tmp/f.txt\"}"}}]}}]}`,
			`{"id":"chatcmpl-2","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
		}

		for _, e := range events {
			_, _ = fmt.Fprintf(w, "data: %s\n\n", e)
			flusher.Flush()
		}
		_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
		flusher.Flush()
	}))
	defer server.Close()

	p := NewCopilotProvider(CopilotConfig{
		Token:   "test-token",
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
	if toolEvent.Tool.ID != "call_123" {
		t.Errorf("expected tool ID call_123, got %s", toolEvent.Tool.ID)
	}
	if toolEvent.Tool.Name != "read_file" {
		t.Errorf("expected tool name read_file, got %s", toolEvent.Tool.Name)
	}
	if toolEvent.Tool.Arguments["path"] != "/tmp/f.txt" {
		t.Errorf("expected path /tmp/f.txt, got %v", toolEvent.Tool.Arguments["path"])
	}
}

func TestCopilotProviderName(t *testing.T) {
	p := NewCopilotProvider(CopilotConfig{})
	if p.Name() != "copilot" {
		t.Errorf("expected name 'copilot', got %q", p.Name())
	}
}

func TestCopilotDefaults(t *testing.T) {
	p := NewCopilotProvider(CopilotConfig{})
	if p.config.Model != defaultCopilotModel {
		t.Errorf("expected default model %s, got %s", defaultCopilotModel, p.config.Model)
	}
	if p.config.BaseURL != defaultCopilotBaseURL {
		t.Errorf("expected default base URL %s, got %s", defaultCopilotBaseURL, p.config.BaseURL)
	}
	if p.config.MaxTokens != defaultCopilotMaxTokens {
		t.Errorf("expected default max tokens %d, got %d", defaultCopilotMaxTokens, p.config.MaxTokens)
	}
}

func TestCopilotCustomConfig(t *testing.T) {
	p := NewCopilotProvider(CopilotConfig{
		Token:     "my-token",
		Model:     "gpt-4o-mini",
		BaseURL:   "https://custom.api.com",
		MaxTokens: 8192,
	})
	if p.config.Model != "gpt-4o-mini" {
		t.Errorf("expected model gpt-4o-mini, got %s", p.config.Model)
	}
	if p.config.BaseURL != "https://custom.api.com" {
		t.Errorf("expected base URL https://custom.api.com, got %s", p.config.BaseURL)
	}
	if p.config.MaxTokens != 8192 {
		t.Errorf("expected max tokens 8192, got %d", p.config.MaxTokens)
	}
	if p.config.Token != "my-token" {
		t.Errorf("expected token my-token, got %s", p.config.Token)
	}
}

func TestCopilotChatNullContent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		resp := copilotResponse{
			ID: "chatcmpl-null",
			Choices: []copilotChoice{
				{
					Index: 0,
					Message: copilotResMsg{
						Role:    "assistant",
						Content: nil,
						ToolCalls: []copilotResToolCall{
							{
								ID:   "call_xyz",
								Type: "function",
								Function: struct {
									Name      string `json:"name"`
									Arguments string `json:"arguments"`
								}{
									Name:      "search",
									Arguments: `{"query":"test"}`,
								},
							},
						},
					},
				},
			},
			Usage: copilotUsage{PromptTokens: 10, CompletionTokens: 5},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	p := NewCopilotProvider(CopilotConfig{
		Token:   "test-token",
		BaseURL: server.URL,
	})

	resp, err := p.Chat(context.Background(), []Message{
		{Role: RoleUser, Content: "Search for test"},
	}, nil)
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}

	if resp.Content != "" {
		t.Errorf("expected empty content for null, got %q", resp.Content)
	}
	if len(resp.ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(resp.ToolCalls))
	}
}

func TestCopilotStreamMultipleToolCalls(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("expected response writer to support flushing")
		}

		// Two parallel tool calls with distinct index values.
		events := []string{
			`{"id":"chatcmpl-3","choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_aaa","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}`,
			`{"id":"chatcmpl-3","choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_bbb","type":"function","function":{"name":"get_time","arguments":""}}]}}]}`,
			`{"id":"chatcmpl-3","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"","type":"function","function":{"name":"","arguments":"{\"city\":\"London\"}"}}]}}]}`,
			`{"id":"chatcmpl-3","choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"","type":"function","function":{"name":"","arguments":"{\"timezone\":\"UTC\"}"}}]}}]}`,
			`{"id":"chatcmpl-3","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
		}

		for _, e := range events {
			_, _ = fmt.Fprintf(w, "data: %s\n\n", e)
			flusher.Flush()
		}
		_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
		flusher.Flush()
	}))
	defer server.Close()

	p := NewCopilotProvider(CopilotConfig{
		Token:   "test-token",
		BaseURL: server.URL,
	})

	ch, err := p.Stream(context.Background(), []Message{
		{Role: RoleUser, Content: "Get weather and time"},
	}, nil)
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}

	var toolEvents []StreamEvent
	for event := range ch {
		switch event.Type {
		case "tool_call":
			toolEvents = append(toolEvents, event)
		case "error":
			t.Fatalf("unexpected error: %s", event.Error)
		}
	}

	if len(toolEvents) != 2 {
		t.Fatalf("expected 2 tool call events, got %d", len(toolEvents))
	}

	calls := make(map[string]StreamEvent)
	for _, e := range toolEvents {
		calls[e.Tool.Name] = e
	}

	weather, ok := calls["get_weather"]
	if !ok {
		t.Fatal("expected get_weather tool call")
	}
	if weather.Tool.ID != "call_aaa" {
		t.Errorf("expected get_weather ID call_aaa, got %s", weather.Tool.ID)
	}
	if weather.Tool.Arguments["city"] != "London" {
		t.Errorf("expected city London, got %v", weather.Tool.Arguments["city"])
	}

	getTime, ok := calls["get_time"]
	if !ok {
		t.Fatal("expected get_time tool call")
	}
	if getTime.Tool.ID != "call_bbb" {
		t.Errorf("expected get_time ID call_bbb, got %s", getTime.Tool.ID)
	}
	if getTime.Tool.Arguments["timezone"] != "UTC" {
		t.Errorf("expected timezone UTC, got %v", getTime.Tool.Arguments["timezone"])
	}
}

func TestListCopilotModels(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") == "" {
				t.Error("expected Authorization header")
			}
			if r.Header.Get("Copilot-Integration-Id") != copilotIntegrationID {
				t.Errorf("expected Copilot-Integration-Id=%s, got %s", copilotIntegrationID, r.Header.Get("Copilot-Integration-Id"))
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprint(w, `{"data":[{"id":"gpt-4.1","name":"GPT-4.1"},{"id":"claude-sonnet-4","name":"Claude Sonnet 4"},{"id":"gpt-4o","name":"GPT-4o"}]}`)
		}))
		defer server.Close()

		models, err := listCopilotModels(context.Background(), "test-token", server.URL)
		if err != nil {
			t.Fatalf("listCopilotModels: %v", err)
		}
		if len(models) != 3 {
			t.Fatalf("expected 3 models, got %d", len(models))
		}
		// Verify sorted by ID
		if models[0].ID != "claude-sonnet-4" {
			t.Errorf("expected first model claude-sonnet-4, got %s", models[0].ID)
		}
		if models[1].ID != "gpt-4.1" {
			t.Errorf("expected second model gpt-4.1, got %s", models[1].ID)
		}
		if models[2].ID != "gpt-4o" {
			t.Errorf("expected third model gpt-4o, got %s", models[2].ID)
		}
		if models[2].Name != "GPT-4o" {
			t.Errorf("expected name GPT-4o, got %s", models[2].Name)
		}
	})

	t.Run("non200_falls_back", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = fmt.Fprint(w, `{"error":"unauthorized"}`)
		}))
		defer server.Close()

		models, err := listCopilotModels(context.Background(), "bad-token", server.URL)
		if err != nil {
			t.Fatalf("expected no error on non-200, got %v", err)
		}
		fallback := copilotFallbackModels()
		if len(models) != len(fallback) {
			t.Errorf("expected %d fallback models, got %d", len(fallback), len(models))
		}
	})

	t.Run("invalid_json_falls_back", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprint(w, `not valid json`)
		}))
		defer server.Close()

		models, err := listCopilotModels(context.Background(), "test-token", server.URL)
		if err != nil {
			t.Fatalf("expected no error on invalid JSON, got %v", err)
		}
		fallback := copilotFallbackModels()
		if len(models) != len(fallback) {
			t.Errorf("expected %d fallback models, got %d", len(fallback), len(models))
		}
	})

	t.Run("empty_data_falls_back", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprint(w, `{"data":[]}`)
		}))
		defer server.Close()

		models, err := listCopilotModels(context.Background(), "test-token", server.URL)
		if err != nil {
			t.Fatalf("expected no error on empty data, got %v", err)
		}
		fallback := copilotFallbackModels()
		if len(models) != len(fallback) {
			t.Errorf("expected %d fallback models, got %d", len(fallback), len(models))
		}
	})
}

func TestCopilotChatInvalidToolArgsJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		content := "calling tool"
		resp := copilotResponse{
			ID: "chatcmpl-bad",
			Choices: []copilotChoice{
				{
					Index: 0,
					Message: copilotResMsg{
						Role:    "assistant",
						Content: &content,
						ToolCalls: []copilotResToolCall{
							{
								ID:   "call_bad",
								Type: "function",
								Function: copilotFunctionCall{
									Name:      "do_thing",
									Arguments: `not valid json`,
								},
							},
						},
					},
				},
			},
			Usage: copilotUsage{PromptTokens: 5, CompletionTokens: 5},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	p := NewCopilotProvider(CopilotConfig{
		Token:   "test-token",
		BaseURL: server.URL,
	})

	_, err := p.Chat(context.Background(), []Message{
		{Role: RoleUser, Content: "Do thing"},
	}, nil)
	if err == nil {
		t.Fatal("expected error for invalid tool arguments JSON")
	}
	if !contains(err.Error(), "do_thing") {
		t.Errorf("expected error to mention tool name, got: %v", err)
	}
}

func TestCopilotStreamInvalidToolArgsJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("expected response writer to support flushing")
		}

		events := []string{
			`{"id":"chatcmpl-bad","choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_bad","type":"function","function":{"name":"do_thing","arguments":""}}]}}]}`,
			`{"id":"chatcmpl-bad","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"","type":"function","function":{"name":"","arguments":"not valid json"}}]}}]}`,
			`{"id":"chatcmpl-bad","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
		}

		for _, e := range events {
			_, _ = fmt.Fprintf(w, "data: %s\n\n", e)
			flusher.Flush()
		}
		_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
		flusher.Flush()
	}))
	defer server.Close()

	p := NewCopilotProvider(CopilotConfig{
		Token:   "test-token",
		BaseURL: server.URL,
	})

	ch, err := p.Stream(context.Background(), []Message{
		{Role: RoleUser, Content: "Do thing"},
	}, nil)
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}

	var errEvent *StreamEvent
	for event := range ch {
		if event.Type == "error" {
			e := event
			errEvent = &e
		}
	}

	if errEvent == nil {
		t.Fatal("expected error event for invalid tool arguments JSON")
	}
	if !contains(errEvent.Error, "do_thing") {
		t.Errorf("expected error to mention tool name, got: %s", errEvent.Error)
	}
}
