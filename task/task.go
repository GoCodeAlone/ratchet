// Package task defines the task model and persistence for agent work items.
package task

import "time"

// Status represents the lifecycle state of a task.
type Status string

const (
	StatusPending    Status = "pending"
	StatusAssigned   Status = "assigned"
	StatusInProgress Status = "in_progress"
	StatusCompleted  Status = "completed"
	StatusFailed     Status = "failed"
	StatusCanceled   Status = "canceled"
)

// Priority determines task scheduling order.
type Priority int

const (
	PriorityLow    Priority = 0
	PriorityNormal Priority = 1
	PriorityHigh   Priority = 2
	PriorityCritical Priority = 3
)

// Task is a unit of work for an agent.
type Task struct {
	ID          string            `json:"id"`
	Title       string            `json:"title"`
	Description string            `json:"description"`
	Status      Status            `json:"status"`
	Priority    Priority          `json:"priority"`
	AssignedTo  string            `json:"assigned_to,omitempty"` // agent ID
	TeamID      string            `json:"team_id,omitempty"`
	ParentID    string            `json:"parent_id,omitempty"` // for sub-tasks
	DependsOn   []string          `json:"depends_on,omitempty"`
	Labels      []string          `json:"labels,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
	Result      string            `json:"result,omitempty"`
	Error       string            `json:"error,omitempty"`
	CreatedAt   time.Time         `json:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at"`
	StartedAt   *time.Time        `json:"started_at,omitempty"`
	CompletedAt *time.Time        `json:"completed_at,omitempty"`
}

// Store persists and retrieves tasks.
type Store interface {
	// Create persists a new task and returns its assigned ID.
	Create(t *Task) (string, error)

	// Get retrieves a task by ID.
	Get(id string) (*Task, error)

	// Update saves changes to an existing task.
	Update(t *Task) error

	// List returns tasks matching the given filter.
	List(filter Filter) ([]*Task, error)

	// Delete removes a task by ID.
	Delete(id string) error
}

// Filter controls which tasks are returned by List.
type Filter struct {
	Status     *Status  `json:"status,omitempty"`
	AssignedTo string   `json:"assigned_to,omitempty"`
	TeamID     string   `json:"team_id,omitempty"`
	ParentID   string   `json:"parent_id,omitempty"`
	Labels     []string `json:"labels,omitempty"`
	Limit      int      `json:"limit,omitempty"`
	Offset     int      `json:"offset,omitempty"`
}
