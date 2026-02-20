package agent

import (
	"context"
	"fmt"
	"sync"

	"github.com/GoCodeAlone/ratchet/comms"
	"github.com/GoCodeAlone/ratchet/task"
)

// Team groups agents under an optional lead and a shared comms bus.
type Team struct {
	ID      string
	Name    string
	Lead    *Runtime
	Members []*Runtime
	Bus     comms.Bus

	mu sync.RWMutex
}

// NewTeam creates an empty team with the given ID, name, and bus.
func NewTeam(id, name string, bus comms.Bus) *Team {
	return &Team{
		ID:   id,
		Name: name,
		Bus:  bus,
	}
}

// AddAgent adds an agent to the team's member list.
func (t *Team) AddAgent(r *Runtime) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.Members = append(t.Members, r)
}

// SetLead designates the given runtime as the team lead.
func (t *Team) SetLead(r *Runtime) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.Lead = r
}

// Start launches all team members (and the lead, if set).
func (t *Team) Start(ctx context.Context) error {
	t.mu.RLock()
	defer t.mu.RUnlock()

	if t.Lead != nil {
		if err := t.Lead.Start(ctx); err != nil {
			return fmt.Errorf("team %s: start lead %s: %w", t.ID, t.Lead.cfg.ID, err)
		}
	}
	for _, m := range t.Members {
		if err := m.Start(ctx); err != nil {
			return fmt.Errorf("team %s: start member %s: %w", t.ID, m.cfg.ID, err)
		}
	}
	return nil
}

// Stop gracefully shuts down all team members and the lead.
func (t *Team) Stop(ctx context.Context) error {
	t.mu.RLock()
	defer t.mu.RUnlock()

	var errs []error
	for _, m := range t.Members {
		if err := m.Stop(ctx); err != nil {
			errs = append(errs, fmt.Errorf("stop member %s: %w", m.cfg.ID, err))
		}
	}
	if t.Lead != nil {
		if err := t.Lead.Stop(ctx); err != nil {
			errs = append(errs, fmt.Errorf("stop lead %s: %w", t.Lead.cfg.ID, err))
		}
	}
	if len(errs) > 0 {
		return errs[0]
	}
	return nil
}

// AssignTask assigns the task to the best available member.
// Prefers idle members; falls back to any non-stopped member.
// If a lead is present, it handles assignment; otherwise assigns round-robin.
func (t *Team) AssignTask(tk *task.Task) error {
	t.mu.RLock()
	defer t.mu.RUnlock()

	if len(t.Members) == 0 && t.Lead == nil {
		return fmt.Errorf("team %s: no agents available", t.ID)
	}

	target := t.pickMember()
	if target == nil {
		return fmt.Errorf("team %s: no available agent for task %s", t.ID, tk.ID)
	}
	tk.AssignedTo = target.cfg.ID
	tk.TeamID = t.ID
	return target.AssignTask(tk)
}

// pickMember selects the best available team member.
// Prefers idle agents; falls back to any non-stopped agent.
func (t *Team) pickMember() *Runtime {
	// Prefer idle members
	for _, m := range t.Members {
		m.mu.RLock()
		status := m.status
		m.mu.RUnlock()
		if status == StatusIdle {
			return m
		}
	}
	// Fall back to any non-stopped member
	for _, m := range t.Members {
		m.mu.RLock()
		status := m.status
		m.mu.RUnlock()
		if status != StatusStopped {
			return m
		}
	}
	// Use lead as last resort
	if t.Lead != nil {
		t.Lead.mu.RLock()
		status := t.Lead.status
		t.Lead.mu.RUnlock()
		if status != StatusStopped {
			return t.Lead
		}
	}
	return nil
}
