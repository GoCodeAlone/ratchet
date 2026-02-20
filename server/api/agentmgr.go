package api

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/GoCodeAlone/ratchet/agent"
	"github.com/GoCodeAlone/ratchet/comms"
	"github.com/GoCodeAlone/ratchet/config"
	"github.com/GoCodeAlone/ratchet/provider/mock"
	"github.com/GoCodeAlone/ratchet/task"
)

// Manager implements AgentManager using in-process agents.
type Manager struct {
	mu     sync.RWMutex
	agents map[string]*managedAgent
	bus    *comms.InMemoryBus
	store  task.Store
	cfg    config.Config
	logger *slog.Logger
}

type managedAgent struct {
	info   agent.Info
	cancel context.CancelFunc
}

// NewAgentManager creates a Manager with agents from the config.
// It sets up an in-memory bus and a no-op in-memory task store.
func NewAgentManager(cfg *config.Config, logger *slog.Logger) *Manager {
	bus := comms.NewInMemoryBus()
	store := newMemStore()

	m := &Manager{
		agents: make(map[string]*managedAgent),
		bus:    bus,
		store:  store,
		cfg:    *cfg,
		logger: logger,
	}

	// Pre-populate agents from config
	for _, ac := range cfg.Agents {
		info := agent.Info{
			ID:   ac.ID,
			Name: ac.Name,
			Personality: &agent.Personality{
				Name:         ac.Name,
				Role:         ac.Role,
				SystemPrompt: ac.SystemPrompt,
				Model:        ac.Model,
			},
			Status: agent.StatusIdle,
			TeamID: ac.TeamID,
			IsLead: ac.IsLead,
		}
		m.agents[ac.ID] = &managedAgent{info: info}
	}
	return m
}

// Bus returns the underlying comms bus.
func (m *Manager) Bus() comms.Bus { return m.bus }

// TaskStore returns the underlying task store.
func (m *Manager) TaskStore() task.Store { return m.store }

// ListAgents returns a snapshot of all agent infos.
func (m *Manager) ListAgents() []agent.Info {
	m.mu.RLock()
	defer m.mu.RUnlock()
	infos := make([]agent.Info, 0, len(m.agents))
	for _, ma := range m.agents {
		infos = append(infos, ma.info)
	}
	return infos
}

// GetAgent returns the agent info for the given ID.
func (m *Manager) GetAgent(id string) (*agent.Info, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	ma, ok := m.agents[id]
	if !ok {
		return nil, false
	}
	info := ma.info
	return &info, true
}

// CreateAgent registers a new agent from the given config.
func (m *Manager) CreateAgent(cfg agent.Config) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if cfg.ID == "" {
		return fmt.Errorf("agent ID is required")
	}
	if _, exists := m.agents[cfg.ID]; exists {
		return fmt.Errorf("agent %s already exists", cfg.ID)
	}
	info := agent.Info{
		ID:          cfg.ID,
		Personality: cfg.Personality,
		Status:      agent.StatusIdle,
		TeamID:      cfg.TeamID,
		IsLead:      cfg.IsLead,
	}
	if cfg.Personality != nil {
		info.Name = cfg.Personality.Name
	}
	m.agents[cfg.ID] = &managedAgent{info: info}
	return nil
}

// StartAgent marks the agent as working and starts a lightweight autonomous loop.
func (m *Manager) StartAgent(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	ma, ok := m.agents[id]
	if !ok {
		return fmt.Errorf("agent %s not found", id)
	}
	if ma.info.Status == agent.StatusWorking {
		return nil // already running
	}

	ctx, cancel := context.WithCancel(context.Background())
	ma.cancel = cancel
	ma.info.Status = agent.StatusWorking

	// Run a minimal agent loop (mock provider — real agent runtime comes from agent package)
	go func() {
		p := mock.New()
		_ = p // provider available for future use
		m.logger.Info("agent started", slog.String("id", id))
		<-ctx.Done()
		m.mu.Lock()
		if a, exists := m.agents[id]; exists {
			a.info.Status = agent.StatusStopped
		}
		m.mu.Unlock()
		m.logger.Info("agent stopped", slog.String("id", id))
	}()
	return nil
}

// StopAgent signals the agent to stop.
func (m *Manager) StopAgent(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	ma, ok := m.agents[id]
	if !ok {
		return fmt.Errorf("agent %s not found", id)
	}
	if ma.cancel != nil {
		ma.cancel()
		ma.cancel = nil
	}
	ma.info.Status = agent.StatusStopped
	return nil
}

// ListTeams derives team info from the registered agents.
func (m *Manager) ListTeams() []TeamInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()

	teams := make(map[string]*TeamInfo)
	for _, ma := range m.agents {
		tid := ma.info.TeamID
		if tid == "" {
			continue
		}
		t, ok := teams[tid]
		if !ok {
			t = &TeamInfo{ID: tid, Name: tid}
			teams[tid] = t
		}
		t.Members = append(t.Members, ma.info)
		if ma.info.IsLead {
			t.LeadID = ma.info.ID
		}
	}

	result := make([]TeamInfo, 0, len(teams))
	for _, t := range teams {
		result = append(result, *t)
	}
	return result
}

// --- in-memory task store (fallback when SQLite is unavailable) ---

type memStore struct {
	mu    sync.RWMutex
	tasks map[string]*task.Task
}

func newMemStore() *memStore {
	return &memStore{tasks: make(map[string]*task.Task)}
}

func (s *memStore) Create(t *task.Task) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if t.ID == "" {
		t.ID = fmt.Sprintf("t-%d", len(s.tasks)+1)
	}
	copy := *t
	s.tasks[t.ID] = &copy
	return t.ID, nil
}

func (s *memStore) Get(id string) (*task.Task, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.tasks[id]
	if !ok {
		return nil, fmt.Errorf("task %s not found", id)
	}
	copy := *t
	return &copy, nil
}

func (s *memStore) Update(t *task.Task) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tasks[t.ID]; !ok {
		return fmt.Errorf("task %s not found", t.ID)
	}
	copy := *t
	s.tasks[t.ID] = &copy
	return nil
}

func (s *memStore) List(filter task.Filter) ([]*task.Task, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*task.Task
	for _, t := range s.tasks {
		if filter.Status != nil && t.Status != *filter.Status {
			continue
		}
		if filter.AssignedTo != "" && t.AssignedTo != filter.AssignedTo {
			continue
		}
		if filter.TeamID != "" && t.TeamID != filter.TeamID {
			continue
		}
		copy := *t
		result = append(result, &copy)
	}
	if filter.Limit > 0 && len(result) > filter.Limit {
		result = result[:filter.Limit]
	}
	return result, nil
}

func (s *memStore) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tasks[id]; !ok {
		return fmt.Errorf("task %s not found", id)
	}
	delete(s.tasks, id)
	return nil
}
