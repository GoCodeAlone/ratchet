// Package ws implements a Server-Sent Events (SSE) hub for real-time agent updates.
package ws

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
)

// Event is a typed real-time event broadcast to connected clients.
type Event struct {
	Type    string `json:"type"`
	Payload any    `json:"payload,omitempty"`
}

// client represents a single SSE connection.
type client struct {
	ch chan []byte
}

// Hub manages SSE client connections and broadcasts events.
type Hub struct {
	mu      sync.RWMutex
	clients map[*client]struct{}
	logger  *slog.Logger
}

// NewHub creates a Hub ready to accept connections.
func NewHub(logger *slog.Logger) *Hub {
	return &Hub{
		clients: make(map[*client]struct{}),
		logger:  logger,
	}
}

// Broadcast sends an event to all connected clients.
func (h *Hub) Broadcast(event Event) {
	data, err := json.Marshal(event)
	if err != nil {
		h.logger.Error("hub broadcast marshal", slog.Any("err", err))
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		select {
		case c.ch <- data:
		default:
			// Drop event if client is slow — don't block
		}
	}
}

// ServeSSE handles an SSE connection request.
func (h *Hub) ServeSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusOK)

	c := &client{ch: make(chan []byte, 64)}

	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()

	defer func() {
		h.mu.Lock()
		delete(h.clients, c)
		h.mu.Unlock()
		close(c.ch)
	}()

	// Send connected event
	fmt.Fprintf(w, "data: {\"type\":\"connected\"}\n\n") //nolint:errcheck
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case data, ok := <-c.ch:
			if !ok {
				return
			}
			// Each SSE "data:" line must not contain newlines
			for _, line := range strings.Split(string(data), "\n") {
				fmt.Fprintf(w, "data: %s\n", line) //nolint:errcheck
			}
			fmt.Fprintln(w) //nolint:errcheck
			flusher.Flush()
		}
	}
}
