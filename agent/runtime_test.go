package agent

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/GoCodeAlone/ratchet/comms"
	"github.com/GoCodeAlone/ratchet/provider/mock"
	"github.com/GoCodeAlone/ratchet/task"
)

func TestRuntime_Info(t *testing.T) {
	r := NewRuntime(Config{
		ID:          "agent-1",
		Personality: &Personality{Name: "TestBot", Role: "worker"},
		Provider:    mock.New(),
		IsLead:      false,
		TeamID:      "team-1",
	})
	info := r.Info()
	if info.ID != "agent-1" {
		t.Errorf("ID = %q, want agent-1", info.ID)
	}
	if info.Name != "TestBot" {
		t.Errorf("Name = %q, want TestBot", info.Name)
	}
	if info.Status != StatusIdle {
		t.Errorf("Status = %q, want idle", info.Status)
	}
}

func TestRuntime_StartStop(t *testing.T) {
	r := NewRuntime(Config{
		ID:       "agent-1",
		Provider: mock.New(),
	})

	ctx := context.Background()
	if err := r.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	time.Sleep(50 * time.Millisecond) // let loop run

	if err := r.Stop(ctx); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	info := r.Info()
	if info.Status != StatusStopped {
		t.Errorf("Status after Stop = %q, want stopped", info.Status)
	}
}

func TestRuntime_ProcessTask_WithMockProvider(t *testing.T) {
	f, err := os.CreateTemp("", "ratchet-agent-*.db")
	if err != nil {
		t.Fatalf("create temp db: %v", err)
	}
	f.Close()
	dbPath := f.Name()
	t.Cleanup(func() { os.Remove(dbPath) })

	store, err := task.NewSQLiteStore(dbPath)
	if err != nil {
		t.Fatalf("NewSQLiteStore: %v", err)
	}
	t.Cleanup(func() { store.Close() })

	p := mock.New("I have completed the task successfully.")

	r := NewRuntime(Config{
		ID:        "agent-1",
		Provider:  p,
		TaskStore: store,
		Personality: &Personality{
			Name:         "Worker",
			Role:         "developer",
			SystemPrompt: "You are a Go developer.",
		},
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := r.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer r.Stop(ctx)

	tk := &task.Task{
		Title:       "Write a hello world",
		Description: "Write a simple hello world Go program",
		Status:      task.StatusPending,
		Priority:    task.PriorityNormal,
		AssignedTo:  "agent-1",
	}
	taskID, err := store.Create(tk)
	if err != nil {
		t.Fatalf("Create task: %v", err)
	}

	// Enqueue via AssignTask
	if err := r.AssignTask(tk); err != nil {
		t.Fatalf("AssignTask: %v", err)
	}

	// Poll the store for completion — avoids direct struct access across goroutines
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		got, err := store.Get(taskID)
		if err != nil {
			t.Fatalf("Get task: %v", err)
		}
		if got.Status == task.StatusCompleted {
			if got.Result == "" {
				t.Error("task result is empty")
			}
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Error("task was not completed within deadline")
}

func TestRuntime_ReceiveMessage(t *testing.T) {
	bus := comms.NewInMemoryBus()
	r := NewRuntime(Config{
		ID:       "agent-1",
		Provider: mock.New(),
		Bus:      bus,
	})

	ctx := context.Background()
	if err := r.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer r.Stop(ctx)

	msg := &comms.Message{
		ID:      "msg-1",
		Type:    comms.TypeDirect,
		From:    "lead",
		To:      "agent-1",
		Subject: "hello",
		Content: "are you there?",
	}
	if err := r.ReceiveMessage(ctx, msg); err != nil {
		t.Fatalf("ReceiveMessage: %v", err)
	}
	// No panic or error is sufficient for now
}

func TestRuntime_SendMessage(t *testing.T) {
	bus := comms.NewInMemoryBus()

	var receivedMsg *comms.Message
	bus.Subscribe("lead", func(_ context.Context, msg *comms.Message) error {
		receivedMsg = msg
		return nil
	})

	r := NewRuntime(Config{
		ID:       "agent-1",
		Provider: mock.New(),
		Bus:      bus,
	})

	ctx := context.Background()
	msg := &comms.Message{
		Type:    comms.TypeDirect,
		Subject: "update",
		Content: "task done",
	}
	if err := r.SendMessage(ctx, "lead", msg); err != nil {
		t.Fatalf("SendMessage: %v", err)
	}

	time.Sleep(50 * time.Millisecond)
	if receivedMsg == nil {
		t.Fatal("lead did not receive the message")
	}
	if receivedMsg.From != "agent-1" {
		t.Errorf("From = %q, want agent-1", receivedMsg.From)
	}
}

func TestRuntime_AssignTask_QueueFull(t *testing.T) {
	r := NewRuntime(Config{
		ID:       "agent-1",
		Provider: mock.New(),
	})
	// Fill the queue without starting the runtime
	for i := 0; i < 64; i++ {
		r.taskQueue <- &task.Task{ID: "filler"}
	}
	err := r.AssignTask(&task.Task{ID: "overflow"})
	if err == nil {
		t.Fatal("expected error when queue is full")
	}
}
