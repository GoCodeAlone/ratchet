package comms

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func makeMsg(from, to string, t MessageType) *Message {
	return &Message{
		ID:        "msg-" + from + "-" + to,
		Type:      t,
		From:      from,
		To:        to,
		Subject:   "test",
		Content:   "hello",
		Timestamp: time.Now(),
	}
}

func TestInMemoryBus_Subscribe_Unsubscribe(t *testing.T) {
	bus := NewInMemoryBus()
	ctx := context.Background()

	var received int32
	unsub := bus.Subscribe("agent-a", func(_ context.Context, _ *Message) error {
		atomic.AddInt32(&received, 1)
		return nil
	})

	msg := makeMsg("agent-b", "agent-a", TypeDirect)
	if err := bus.Publish(ctx, msg); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if atomic.LoadInt32(&received) != 1 {
		t.Errorf("received = %d, want 1", received)
	}

	// Unsubscribe and verify no more messages
	unsub()
	if err := bus.Publish(ctx, msg); err != nil {
		t.Fatalf("Publish after unsub: %v", err)
	}
	if atomic.LoadInt32(&received) != 1 {
		t.Errorf("received after unsub = %d, want 1", received)
	}
}

func TestInMemoryBus_Broadcast(t *testing.T) {
	bus := NewInMemoryBus()
	ctx := context.Background()

	var wg sync.WaitGroup
	var count int32

	for _, id := range []string{"agent-a", "agent-b", "agent-c"} {
		wg.Add(1)
		agentID := id
		bus.Subscribe(agentID, func(_ context.Context, _ *Message) error {
			atomic.AddInt32(&count, 1)
			wg.Done()
			return nil
		})
	}

	msg := &Message{
		ID:      "bcast-1",
		Type:    TypeBroadcast,
		From:    "lead",
		Subject: "all hands",
		Content: "meeting now",
	}
	if err := bus.Publish(ctx, msg); err != nil {
		t.Fatalf("Publish broadcast: %v", err)
	}

	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for broadcast delivery")
	}

	if atomic.LoadInt32(&count) != 3 {
		t.Errorf("broadcast delivered to %d agents, want 3", count)
	}
}

func TestInMemoryBus_DirectMessage(t *testing.T) {
	bus := NewInMemoryBus()
	ctx := context.Background()

	var aReceived, bReceived int32
	bus.Subscribe("agent-a", func(_ context.Context, _ *Message) error {
		atomic.AddInt32(&aReceived, 1)
		return nil
	})
	bus.Subscribe("agent-b", func(_ context.Context, _ *Message) error {
		atomic.AddInt32(&bReceived, 1)
		return nil
	})

	msg := makeMsg("lead", "agent-a", TypeDirect)
	if err := bus.Publish(ctx, msg); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	if atomic.LoadInt32(&aReceived) != 1 {
		t.Errorf("agent-a received %d, want 1", aReceived)
	}
	if atomic.LoadInt32(&bReceived) != 0 {
		t.Errorf("agent-b received %d, want 0", bReceived)
	}
}

func TestInMemoryBus_History(t *testing.T) {
	bus := NewInMemoryBus()
	ctx := context.Background()

	// Subscribe to prevent errors (no handlers required for history)
	bus.Subscribe("agent-a", func(_ context.Context, _ *Message) error { return nil })

	msgs := []*Message{
		makeMsg("lead", "agent-a", TypeDirect),
		makeMsg("agent-a", "lead", TypeDirect),
		makeMsg("lead", "agent-b", TypeDirect), // not visible to agent-a
		{ID: "b1", Type: TypeBroadcast, From: "system", Subject: "s", Timestamp: time.Now()},
	}
	for _, m := range msgs {
		bus.Publish(ctx, m)
	}

	hist, err := bus.History("agent-a", 100)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	// Should see: to agent-a, from agent-a, broadcast = 3 messages
	if len(hist) != 3 {
		t.Errorf("History len = %d, want 3", len(hist))
	}
}

func TestInMemoryBus_History_Limit(t *testing.T) {
	bus := NewInMemoryBus()
	ctx := context.Background()
	bus.Subscribe("agent-a", func(_ context.Context, _ *Message) error { return nil })

	for i := 0; i < 10; i++ {
		m := makeMsg("sender", "agent-a", TypeDirect)
		bus.Publish(ctx, m)
	}

	hist, err := bus.History("agent-a", 5)
	if err != nil {
		t.Fatalf("History: %v", err)
	}
	if len(hist) != 5 {
		t.Errorf("History with limit 5 returned %d messages", len(hist))
	}
}

func TestInMemoryBus_MultipleSubscribers(t *testing.T) {
	bus := NewInMemoryBus()
	ctx := context.Background()

	var count int32
	bus.Subscribe("agent-a", func(_ context.Context, _ *Message) error {
		atomic.AddInt32(&count, 1)
		return nil
	})
	bus.Subscribe("agent-a", func(_ context.Context, _ *Message) error {
		atomic.AddInt32(&count, 1)
		return nil
	})

	msg := makeMsg("sender", "agent-a", TypeDirect)
	bus.Publish(ctx, msg)

	if atomic.LoadInt32(&count) != 2 {
		t.Errorf("count = %d, want 2 (both handlers fired)", count)
	}
}
