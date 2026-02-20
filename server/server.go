// Package server implements the Ratchet HTTP server, REST API, auth, and SSE real-time events.
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/GoCodeAlone/ratchet/comms"
	"github.com/GoCodeAlone/ratchet/config"
	"github.com/GoCodeAlone/ratchet/server/api"
	"github.com/GoCodeAlone/ratchet/task"
)

// Server is the Ratchet HTTP server.
type Server struct {
	cfg     config.Config
	mux     *http.ServeMux
	httpSrv *http.Server
	logger  *slog.Logger

	agents   api.AgentManager
	tasks    task.Store
	bus      comms.Bus
	handlers *api.Handlers

	// SSE clients
	sseMu      sync.RWMutex
	sseClients map[chan []byte]struct{}

	// JWT secret caching
	secretOnce      sync.Once
	generatedSecret string

	startTime time.Time
	version   string
}

// New creates a new Server with the given config and logger.
func New(cfg config.Config, ver string, logger *slog.Logger) *Server {
	s := &Server{
		cfg:        cfg,
		mux:        http.NewServeMux(),
		logger:     logger,
		sseClients: make(map[chan []byte]struct{}),
		startTime:  time.Now(),
		version:    ver,
	}
	return s
}

// SetAgentManager attaches an agent manager to the server.
func (s *Server) SetAgentManager(mgr api.AgentManager) {
	s.agents = mgr
}

// SetTaskStore attaches a task store to the server.
func (s *Server) SetTaskStore(store task.Store) {
	s.tasks = store
}

// SetBus attaches a comms bus to the server.
func (s *Server) SetBus(bus comms.Bus) {
	s.bus = bus
}

// SetStaticFS sets the embedded filesystem to serve UI files from.
// Call before Start.
func (s *Server) SetStaticFS(fsys fs.FS) {
	s.mux.Handle("/", http.FileServerFS(fsys))
}

// Start registers routes and begins listening.
func (s *Server) Start() error {
	s.registerRoutes()

	addr := s.cfg.Server.Addr
	if addr == "" {
		addr = ":9090"
	}
	s.httpSrv = &http.Server{
		Addr:              addr,
		Handler:           s.mux,
		ReadHeaderTimeout: 15 * time.Second,
	}
	s.logger.Info("server listening", slog.String("addr", addr))
	return s.httpSrv.ListenAndServe()
}

// Stop gracefully shuts down the HTTP server.
func (s *Server) Stop(ctx context.Context) error {
	if s.httpSrv == nil {
		return nil
	}
	return s.httpSrv.Shutdown(ctx)
}

// registerRoutes sets up all HTTP routes.
func (s *Server) registerRoutes() {
	h := &api.Handlers{
		Agents:  s.agents,
		Tasks:   s.tasks,
		Bus:     s.bus,
		Logger:  s.logger,
		Version: s.version,
	}
	s.handlers = h

	// Public routes (no auth required)
	s.mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	s.mux.HandleFunc("GET /api/status", h.StatusHandler())

	// SSE — auth handled inline because EventSource can't set headers
	s.mux.HandleFunc("GET /events", s.handleSSE)

	// Protected API — wrapped in auth middleware
	apiMux := http.NewServeMux()
	h.RegisterRoutes(apiMux)
	apiMux.HandleFunc("GET /api/auth/me", s.handleMe)

	s.mux.Handle("/api/", s.authMiddleware(apiMux))
}

// writeJSON encodes v as JSON and writes it with the given status code.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeJSONError writes a JSON error response.
func writeJSONError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// handleSSE implements Server-Sent Events for real-time updates.
func (s *Server) handleSSE(w http.ResponseWriter, r *http.Request) {
	// Verify auth via query token param for SSE (EventSource can't set headers)
	token := r.URL.Query().Get("token")
	if token != "" {
		if _, err := verifyJWT(s.jwtSecret(), token); err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
	}

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

	ch := make(chan []byte, 64)
	s.sseMu.Lock()
	s.sseClients[ch] = struct{}{}
	s.sseMu.Unlock()

	defer func() {
		s.sseMu.Lock()
		delete(s.sseClients, ch)
		s.sseMu.Unlock()
		close(ch)
	}()

	// Send initial connected event
	fmt.Fprintf(w, "data: {\"type\":\"connected\"}\n\n") //nolint:errcheck
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case data, ok := <-ch:
			if !ok {
				return
			}
			lines := strings.Split(string(data), "\n")
			for _, line := range lines {
				fmt.Fprintf(w, "data: %s\n", line) //nolint:errcheck
			}
			fmt.Fprintln(w) //nolint:errcheck
			flusher.Flush()
		}
	}
}

// BroadcastEvent sends a JSON-encoded event to all connected SSE clients.
func (s *Server) BroadcastEvent(eventType string, payload any) {
	data, err := json.Marshal(map[string]any{
		"type":    eventType,
		"payload": payload,
	})
	if err != nil {
		s.logger.Error("broadcast event marshal", slog.Any("err", err))
		return
	}

	s.sseMu.RLock()
	defer s.sseMu.RUnlock()
	for ch := range s.sseClients {
		select {
		case ch <- data:
		default:
			// Client channel full, skip
		}
	}
}
