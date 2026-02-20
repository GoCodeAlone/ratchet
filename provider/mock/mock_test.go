package mock

import (
	"context"
	"testing"

	"github.com/GoCodeAlone/ratchet/provider"
)

func TestMockProvider_Name(t *testing.T) {
	m := New()
	if got := m.Name(); got != "mock" {
		t.Errorf("Name() = %q, want %q", got, "mock")
	}
}

func TestMockProvider_Chat_DefaultResponse(t *testing.T) {
	m := New()
	resp, err := m.Chat(context.Background(), nil, nil)
	if err != nil {
		t.Fatalf("Chat() error = %v", err)
	}
	if resp.Content != defaultResponse {
		t.Errorf("Chat() content = %q, want %q", resp.Content, defaultResponse)
	}
}

func TestMockProvider_Chat_CyclesResponses(t *testing.T) {
	m := New("first", "second", "third")

	want := []string{"first", "second", "third", "first"}
	for i, w := range want {
		resp, err := m.Chat(context.Background(), nil, nil)
		if err != nil {
			t.Fatalf("Chat() call %d error = %v", i, err)
		}
		if resp.Content != w {
			t.Errorf("Chat() call %d = %q, want %q", i, resp.Content, w)
		}
	}
}

func TestMockProvider_Chat_WithMessagesAndTools(t *testing.T) {
	m := New("hello")
	msgs := []provider.Message{{Role: provider.RoleUser, Content: "hi"}}
	tools := []provider.ToolDef{{Name: "mytool", Description: "does stuff"}}
	resp, err := m.Chat(context.Background(), msgs, tools)
	if err != nil {
		t.Fatalf("Chat() error = %v", err)
	}
	if resp.Content != "hello" {
		t.Errorf("Chat() content = %q, want %q", resp.Content, "hello")
	}
}

func TestMockProvider_Stream(t *testing.T) {
	m := New("streaming response")
	ch, err := m.Stream(context.Background(), nil, nil)
	if err != nil {
		t.Fatalf("Stream() error = %v", err)
	}

	var events []provider.StreamEvent
	for e := range ch {
		events = append(events, e)
	}

	if len(events) < 2 {
		t.Fatalf("Stream() got %d events, want at least 2", len(events))
	}
	if events[0].Type != "text" {
		t.Errorf("events[0].Type = %q, want %q", events[0].Type, "text")
	}
	if events[0].Text != "streaming response" {
		t.Errorf("events[0].Text = %q, want %q", events[0].Text, "streaming response")
	}
	last := events[len(events)-1]
	if last.Type != "done" {
		t.Errorf("last event Type = %q, want %q", last.Type, "done")
	}
}

func TestMockProvider_Stream_DefaultResponse(t *testing.T) {
	m := New()
	ch, err := m.Stream(context.Background(), nil, nil)
	if err != nil {
		t.Fatalf("Stream() error = %v", err)
	}

	var textEvent *provider.StreamEvent
	for e := range ch {
		ev := e
		if ev.Type == "text" {
			textEvent = &ev
		}
	}
	if textEvent == nil {
		t.Fatal("no text event received")
	}
	if textEvent.Text != defaultResponse {
		t.Errorf("Stream() text = %q, want %q", textEvent.Text, defaultResponse)
	}
}
