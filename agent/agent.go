// Package agent implements the autonomous AI agent runtime.
package agent

import (
	"context"
	"time"

	"github.com/GoCodeAlone/ratchet/comms"
	"github.com/GoCodeAlone/ratchet/provider"
	"github.com/GoCodeAlone/ratchet/task"
)

// Status represents the current state of an agent.
type Status string

const (
	StatusIdle     Status = "idle"
	StatusWorking  Status = "working"
	StatusWaiting  Status = "waiting" // waiting for another agent
	StatusStopped  Status = "stopped"
	StatusError    Status = "error"
)

// Personality defines the agent's behavior, tone, and role.
type Personality struct {
	Name         string `json:"name" yaml:"name"`
	Role         string `json:"role" yaml:"role"`                   // e.g., "developer", "qa", "architect"
	SystemPrompt string `json:"system_prompt" yaml:"system_prompt"` // full system prompt
	Model        string `json:"model,omitempty" yaml:"model"`       // provider-specific model name
}

// Info provides read-only metadata about a running agent.
type Info struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Personality *Personality `json:"personality"`
	Status      Status      `json:"status"`
	CurrentTask string      `json:"current_task,omitempty"`
	StartedAt   time.Time   `json:"started_at"`
	TeamID      string      `json:"team_id,omitempty"`
	IsLead      bool        `json:"is_lead"`
}

// Agent is an autonomous AI entity that can execute tasks, communicate with
// other agents, and make decisions without human intervention.
type Agent interface {
	// Info returns the agent's current metadata.
	Info() Info

	// Start begins the agent's autonomous loop. It processes tasks from its
	// queue and communicates with peers via the message bus.
	Start(ctx context.Context) error

	// Stop gracefully shuts down the agent.
	Stop(ctx context.Context) error

	// AssignTask gives the agent a task to work on.
	AssignTask(t *task.Task) error

	// SendMessage sends a message to another agent via the comms bus.
	SendMessage(ctx context.Context, to string, msg *comms.Message) error

	// ReceiveMessage handles an incoming message from another agent.
	ReceiveMessage(ctx context.Context, msg *comms.Message) error
}

// Config holds the configuration needed to create an agent.
type Config struct {
	ID          string       `json:"id" yaml:"id"`
	Personality *Personality `json:"personality" yaml:"personality"`
	Provider    provider.Provider
	Bus         comms.Bus
	TaskStore   task.Store
	IsLead      bool   `json:"is_lead" yaml:"is_lead"`
	TeamID      string `json:"team_id" yaml:"team_id"`
}
