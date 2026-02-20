package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/GoCodeAlone/ratchet/agent"
	"github.com/GoCodeAlone/ratchet/comms"
	"github.com/GoCodeAlone/ratchet/server/api"
	"github.com/GoCodeAlone/ratchet/task"
)

// --- Test doubles ---

type fakeAgentManager struct {
	agents map[string]agent.Info
}

func newFakeAgentManager() *fakeAgentManager {
	return &fakeAgentManager{agents: make(map[string]agent.Info)}
}

func (f *fakeAgentManager) ListAgents() []agent.Info {
	infos := make([]agent.Info, 0, len(f.agents))
	for _, a := range f.agents {
		infos = append(infos, a)
	}
	return infos
}

func (f *fakeAgentManager) GetAgent(id string) (*agent.Info, bool) {
	a, ok := f.agents[id]
	if !ok {
		return nil, false
	}
	return &a, true
}

func (f *fakeAgentManager) CreateAgent(cfg agent.Config) error {
	f.agents[cfg.ID] = agent.Info{ID: cfg.ID, Status: agent.StatusIdle}
	return nil
}

func (f *fakeAgentManager) StartAgent(id string) error {
	a, ok := f.agents[id]
	if !ok {
		return nil
	}
	a.Status = agent.StatusWorking
	f.agents[id] = a
	return nil
}

func (f *fakeAgentManager) StopAgent(id string) error {
	a, ok := f.agents[id]
	if !ok {
		return nil
	}
	a.Status = agent.StatusStopped
	f.agents[id] = a
	return nil
}

func (f *fakeAgentManager) ListTeams() []api.TeamInfo { return nil }

type fakeTaskStore struct {
	tasks map[string]*task.Task
}

func newFakeTaskStore() *fakeTaskStore {
	return &fakeTaskStore{tasks: make(map[string]*task.Task)}
}

func (s *fakeTaskStore) Create(t *task.Task) (string, error) {
	t.ID = "task-1"
	copy := *t
	s.tasks[t.ID] = &copy
	return t.ID, nil
}

func (s *fakeTaskStore) Get(id string) (*task.Task, error) {
	t, ok := s.tasks[id]
	if !ok {
		return nil, fmt.Errorf("task %s not found", id)
	}
	copy := *t
	return &copy, nil
}

func (s *fakeTaskStore) Update(t *task.Task) error {
	copy := *t
	s.tasks[t.ID] = &copy
	return nil
}

func (s *fakeTaskStore) List(_ task.Filter) ([]*task.Task, error) {
	var result []*task.Task
	for _, t := range s.tasks {
		copy := *t
		result = append(result, &copy)
	}
	return result, nil
}

func (s *fakeTaskStore) Delete(id string) error {
	delete(s.tasks, id)
	return nil
}

type fakeBus struct{}

func (b *fakeBus) Publish(_ context.Context, _ *comms.Message) error        { return nil }
func (b *fakeBus) Subscribe(_ string, _ comms.Handler) (unsubscribe func()) { return func() {} }
func (b *fakeBus) History(_ string, _ int) ([]*comms.Message, error)        { return nil, nil }

// --- Test helpers ---

func newHandlers(t *testing.T) (*api.Handlers, *http.ServeMux) {
	t.Helper()
	mux := http.NewServeMux()
	h := &api.Handlers{
		Agents:  newFakeAgentManager(),
		Tasks:   newFakeTaskStore(),
		Bus:     &fakeBus{},
		Logger:  slog.Default(),
		Version: "test",
	}
	h.RegisterRoutes(mux)
	return h, mux
}

// --- Tests ---

func TestListAgents_Empty(t *testing.T) {
	_, mux := newHandlers(t)
	req := httptest.NewRequest(http.MethodGet, "/api/agents", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	var agents []agent.Info
	if err := json.NewDecoder(rr.Body).Decode(&agents); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if agents == nil {
		t.Error("expected empty array, not null")
	}
}

func TestCreateAndGetAgent(t *testing.T) {
	_, mux := newHandlers(t)

	// Create agent
	body := `{"id":"test-agent","personality":{"name":"Test","role":"developer","system_prompt":"test"}}`
	req := httptest.NewRequest(http.MethodPost, "/api/agents", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d: %s", rr.Code, rr.Body.String())
	}

	// Get agent
	req2 := httptest.NewRequest(http.MethodGet, "/api/agents/test-agent", nil)
	rr2 := httptest.NewRecorder()
	mux.ServeHTTP(rr2, req2)

	if rr2.Code != http.StatusOK {
		t.Fatalf("get: expected 200, got %d: %s", rr2.Code, rr2.Body.String())
	}
	var info agent.Info
	if err := json.NewDecoder(rr2.Body).Decode(&info); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if info.ID != "test-agent" {
		t.Errorf("expected ID 'test-agent', got %q", info.ID)
	}
}

func TestGetAgent_NotFound(t *testing.T) {
	_, mux := newHandlers(t)
	req := httptest.NewRequest(http.MethodGet, "/api/agents/nonexistent", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}

func TestCreateAndListTasks(t *testing.T) {
	_, mux := newHandlers(t)

	// Create task
	body := `{"title":"Test task","status":"pending","priority":1}`
	req := httptest.NewRequest(http.MethodPost, "/api/tasks", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var created task.Task
	if err := json.NewDecoder(rr.Body).Decode(&created); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if created.ID == "" {
		t.Error("expected non-empty task ID")
	}

	// List tasks
	req2 := httptest.NewRequest(http.MethodGet, "/api/tasks", nil)
	rr2 := httptest.NewRecorder()
	mux.ServeHTTP(rr2, req2)

	if rr2.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d", rr2.Code)
	}
	var tasks []*task.Task
	if err := json.NewDecoder(rr2.Body).Decode(&tasks); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(tasks) != 1 {
		t.Errorf("expected 1 task, got %d", len(tasks))
	}
}

func TestStatusEndpoint(t *testing.T) {
	_, mux := newHandlers(t)
	req := httptest.NewRequest(http.MethodGet, "/api/status", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	var resp map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["status"] != "ok" {
		t.Errorf("expected status 'ok', got %q", resp["status"])
	}
}
