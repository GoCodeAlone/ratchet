package comms

import (
	"context"
	"fmt"
	"sync"
)

// InMemoryBus is a thread-safe in-process message bus.
type InMemoryBus struct {
	mu       sync.RWMutex
	handlers map[string][]handlerEntry // agentID -> handlers
	history  []*Message
	maxHist  int
}

type handlerEntry struct {
	id      int
	handler Handler
}

var entryCounter int

// NewInMemoryBus creates an InMemoryBus with a 1000-message history cap.
func NewInMemoryBus() *InMemoryBus {
	return &InMemoryBus{
		handlers: make(map[string][]handlerEntry),
		maxHist:  1000,
	}
}

// Publish sends a message to its intended recipients.
// For TypeBroadcast messages the To field is ignored and all subscribers receive it.
// For direct messages, only the subscriber matching msg.To receives it.
func (b *InMemoryBus) Publish(ctx context.Context, msg *Message) error {
	b.mu.Lock()
	// Append to history
	b.history = append(b.history, msg)
	if len(b.history) > b.maxHist {
		b.history = b.history[len(b.history)-b.maxHist:]
	}

	// Collect handlers to invoke outside the lock
	var targets []Handler
	if msg.Type == TypeBroadcast {
		for _, entries := range b.handlers {
			for _, e := range entries {
				targets = append(targets, e.handler)
			}
		}
	} else {
		for _, e := range b.handlers[msg.To] {
			targets = append(targets, e.handler)
		}
	}
	b.mu.Unlock()

	var errs []error
	for _, h := range targets {
		if err := h(ctx, msg); err != nil {
			errs = append(errs, err)
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("publish: %d handler error(s): %v", len(errs), errs[0])
	}
	return nil
}

// Subscribe registers a handler for messages addressed to agentID.
// The returned function unsubscribes the handler.
func (b *InMemoryBus) Subscribe(agentID string, handler Handler) (unsubscribe func()) {
	b.mu.Lock()
	defer b.mu.Unlock()

	entryCounter++
	id := entryCounter
	b.handlers[agentID] = append(b.handlers[agentID], handlerEntry{id: id, handler: handler})

	return func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		entries := b.handlers[agentID]
		filtered := entries[:0]
		for _, e := range entries {
			if e.id != id {
				filtered = append(filtered, e)
			}
		}
		if len(filtered) == 0 {
			delete(b.handlers, agentID)
		} else {
			b.handlers[agentID] = filtered
		}
	}
}

// History returns the most recent limit messages visible to agentID.
// It includes direct messages (To == agentID), broadcasts from the same team,
// and messages sent by agentID.
func (b *InMemoryBus) History(agentID string, limit int) ([]*Message, error) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	var result []*Message
	for i := len(b.history) - 1; i >= 0; i-- {
		m := b.history[i]
		if m.To == agentID || m.From == agentID || m.Type == TypeBroadcast {
			result = append(result, m)
			if limit > 0 && len(result) >= limit {
				break
			}
		}
	}
	// Reverse to chronological order
	for l, r := 0, len(result)-1; l < r; l, r = l+1, r-1 {
		result[l], result[r] = result[r], result[l]
	}
	return result, nil
}
