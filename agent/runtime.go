package agent

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/GoCodeAlone/ratchet/comms"
	"github.com/GoCodeAlone/ratchet/provider"
	"github.com/GoCodeAlone/ratchet/task"
)

// Runtime is the concrete implementation of the Agent interface.
type Runtime struct {
	mu        sync.RWMutex
	cfg       Config
	status    Status
	startedAt time.Time
	curTask   string // current task ID

	taskQueue chan *task.Task
	inbox     chan *comms.Message

	cancel    context.CancelFunc
	unsub     func()
}

// NewRuntime creates a new agent runtime from the given config.
func NewRuntime(cfg Config) *Runtime {
	return &Runtime{
		cfg:       cfg,
		status:    StatusIdle,
		taskQueue: make(chan *task.Task, 64),
		inbox:     make(chan *comms.Message, 256),
	}
}

// Info returns the agent's current metadata.
func (r *Runtime) Info() Info {
	r.mu.RLock()
	defer r.mu.RUnlock()
	info := Info{
		ID:        r.cfg.ID,
		Status:    r.status,
		StartedAt: r.startedAt,
		TeamID:    r.cfg.TeamID,
		IsLead:    r.cfg.IsLead,
	}
	if r.cfg.Personality != nil {
		info.Name = r.cfg.Personality.Name
		info.Personality = r.cfg.Personality
	}
	info.CurrentTask = r.curTask
	return info
}

// Start begins the agent's autonomous loop.
func (r *Runtime) Start(ctx context.Context) error {
	r.mu.Lock()
	if r.status != StatusIdle && r.status != StatusStopped {
		r.mu.Unlock()
		return fmt.Errorf("agent %s already running (status=%s)", r.cfg.ID, r.status)
	}
	ctx, cancel := context.WithCancel(ctx)
	r.cancel = cancel
	r.status = StatusIdle
	r.startedAt = time.Now()
	r.mu.Unlock()

	// Subscribe to messages
	if r.cfg.Bus != nil {
		unsub := r.cfg.Bus.Subscribe(r.cfg.ID, func(_ context.Context, msg *comms.Message) error {
			select {
			case r.inbox <- msg:
			default:
			}
			return nil
		})
		r.mu.Lock()
		r.unsub = unsub
		r.mu.Unlock()
	}

	go r.loop(ctx)
	return nil
}

// Stop gracefully shuts down the agent.
func (r *Runtime) Stop(_ context.Context) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cancel != nil {
		r.cancel()
		r.cancel = nil
	}
	if r.unsub != nil {
		r.unsub()
		r.unsub = nil
	}
	r.status = StatusStopped
	return nil
}

// AssignTask enqueues a task for the agent to process.
func (r *Runtime) AssignTask(t *task.Task) error {
	select {
	case r.taskQueue <- t:
		return nil
	default:
		return fmt.Errorf("agent %s task queue full", r.cfg.ID)
	}
}

// SendMessage publishes a message via the comms bus.
func (r *Runtime) SendMessage(ctx context.Context, to string, msg *comms.Message) error {
	if r.cfg.Bus == nil {
		return fmt.Errorf("agent %s has no comms bus", r.cfg.ID)
	}
	msg.From = r.cfg.ID
	msg.To = to
	return r.cfg.Bus.Publish(ctx, msg)
}

// ReceiveMessage handles an incoming message directly (bypasses subscription).
func (r *Runtime) ReceiveMessage(_ context.Context, msg *comms.Message) error {
	select {
	case r.inbox <- msg:
		return nil
	default:
		return fmt.Errorf("agent %s inbox full", r.cfg.ID)
	}
}

// loop is the core autonomous agent loop.
func (r *Runtime) loop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			r.mu.Lock()
			if r.status != StatusStopped {
				r.status = StatusStopped
			}
			r.mu.Unlock()
			return
		case msg := <-r.inbox:
			r.handleMessage(ctx, msg)
		case t := <-r.taskQueue:
			r.processTask(ctx, t)
		default:
			// Try fetching from store when queue is empty
			if t := r.fetchNextTask(ctx); t != nil {
				r.processTask(ctx, t)
			} else {
				r.mu.Lock()
				r.status = StatusIdle
				r.mu.Unlock()
				// Brief pause to avoid busy-loop
				select {
				case <-ctx.Done():
					return
				case msg := <-r.inbox:
					r.handleMessage(ctx, msg)
				case t := <-r.taskQueue:
					r.processTask(ctx, t)
				case <-time.After(500 * time.Millisecond):
				}
			}
		}
	}
}

// fetchNextTask retrieves the next pending task from the store (if configured).
func (r *Runtime) fetchNextTask(ctx context.Context) *task.Task {
	if r.cfg.TaskStore == nil {
		return nil
	}
	status := task.StatusPending
	tasks, err := r.cfg.TaskStore.List(task.Filter{
		AssignedTo: r.cfg.ID,
		Status:     &status,
		Limit:      1,
	})
	if err != nil || len(tasks) == 0 {
		return nil
	}
	_ = ctx
	return tasks[0]
}

// handleMessage processes an incoming inter-agent message.
func (r *Runtime) handleMessage(ctx context.Context, msg *comms.Message) {
	log.Printf("[%s] received message from %s: %s", r.cfg.ID, msg.From, msg.Subject)

	// If it's a task assignment message, extract and queue the task
	if msg.Type == comms.TypeTaskUpdate && r.cfg.TaskStore != nil {
		if taskID, ok := msg.Metadata["task_id"]; ok {
			t, err := r.cfg.TaskStore.Get(taskID)
			if err == nil && (t.AssignedTo == r.cfg.ID || t.AssignedTo == "") {
				r.taskQueue <- t
			}
		}
	}
	_ = ctx
}

// processTask runs the autonomous loop for a single task.
func (r *Runtime) processTask(ctx context.Context, t *task.Task) {
	r.mu.Lock()
	r.status = StatusWorking
	r.curTask = t.ID
	r.mu.Unlock()

	defer func() {
		r.mu.Lock()
		r.status = StatusIdle
		r.curTask = ""
		r.mu.Unlock()
	}()

	log.Printf("[%s] starting task %s: %s", r.cfg.ID, t.ID, t.Title)

	// Mark task in progress
	if r.cfg.TaskStore != nil {
		now := time.Now()
		t.Status = task.StatusInProgress
		t.StartedAt = &now
		_ = r.cfg.TaskStore.Update(t)
	}

	// Build conversation messages
	messages := r.buildMessages(t)

	const maxIter = 10
	for i := 0; i < maxIter; i++ {
		select {
		case <-ctx.Done():
			return
		default:
		}

		resp, err := r.cfg.Provider.Chat(ctx, messages, nil)
		if err != nil {
			log.Printf("[%s] provider error: %v", r.cfg.ID, err)
			r.completeTask(t, "", fmt.Sprintf("provider error: %v", err), task.StatusFailed)
			return
		}

		// If no tool calls, consider task done
		if len(resp.ToolCalls) == 0 {
			r.completeTask(t, resp.Content, "", task.StatusCompleted)
			return
		}

		// Execute tool calls (no-op for now)
		messages = append(messages, provider.Message{
			Role:    provider.RoleAssistant,
			Content: resp.Content,
		})
		for _, tc := range resp.ToolCalls {
			result := r.executeTool(ctx, tc)
			messages = append(messages, provider.Message{
				Role:       provider.RoleTool,
				Content:    result,
				ToolCallID: tc.ID,
			})
		}
	}

	r.completeTask(t, "Max iterations reached", "", task.StatusCompleted)
}

// buildMessages constructs the conversation context for a task.
func (r *Runtime) buildMessages(t *task.Task) []provider.Message {
	var msgs []provider.Message

	// System prompt
	sysPrompt := "You are an autonomous AI agent."
	if r.cfg.Personality != nil && r.cfg.Personality.SystemPrompt != "" {
		sysPrompt = r.cfg.Personality.SystemPrompt
	}
	msgs = append(msgs, provider.Message{
		Role:    provider.RoleSystem,
		Content: sysPrompt,
	})

	// Task description
	var taskContent strings.Builder
	taskContent.WriteString("Task: ")
	taskContent.WriteString(t.Title)
	if t.Description != "" {
		taskContent.WriteString("\n\nDescription: ")
		taskContent.WriteString(t.Description)
	}
	msgs = append(msgs, provider.Message{
		Role:    provider.RoleUser,
		Content: taskContent.String(),
	})

	return msgs
}

// executeTool runs a tool call and returns its result.
// Currently a no-op stub.
func (r *Runtime) executeTool(_ context.Context, tc provider.ToolCall) string {
	log.Printf("[%s] executing tool %s (args=%v)", r.cfg.ID, tc.Name, tc.Arguments)
	return "Tool executed successfully"
}

// completeTask updates the task's final state.
func (r *Runtime) completeTask(t *task.Task, result, errMsg string, status task.Status) {
	log.Printf("[%s] task %s complete (status=%s)", r.cfg.ID, t.ID, status)
	t.Status = status
	t.Result = result
	t.Error = errMsg
	now := time.Now()
	t.CompletedAt = &now

	if r.cfg.TaskStore != nil {
		if err := r.cfg.TaskStore.Update(t); err != nil {
			log.Printf("[%s] failed to update task %s: %v", r.cfg.ID, t.ID, err)
		}
	}

	// Notify team if bus is available
	if r.cfg.Bus != nil {
		meta := map[string]string{"task_id": t.ID, "status": string(status)}
		msg := &comms.Message{
			Type:     comms.TypeTaskUpdate,
			From:     r.cfg.ID,
			TeamID:   r.cfg.TeamID,
			Subject:  fmt.Sprintf("Task %s %s", t.Title, status),
			Content:  result,
			Metadata: meta,
		}
		if r.cfg.IsLead {
			msg.Type = comms.TypeBroadcast
		}
		_ = r.cfg.Bus.Publish(context.Background(), msg)
	}
}
