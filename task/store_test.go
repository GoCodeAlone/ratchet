package task

import (
	"os"
	"testing"
)

func newTestStore(t *testing.T) *SQLiteStore {
	t.Helper()
	f, err := os.CreateTemp("", "ratchet-task-*.db")
	if err != nil {
		t.Fatalf("create temp file: %v", err)
	}
	f.Close()
	path := f.Name()
	t.Cleanup(func() { os.Remove(path) })

	store, err := NewSQLiteStore(path)
	if err != nil {
		t.Fatalf("NewSQLiteStore: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func TestSQLiteStore_CreateAndGet(t *testing.T) {
	store := newTestStore(t)

	task := &Task{
		Title:       "Test task",
		Description: "Do something",
		Status:      StatusPending,
		Priority:    PriorityHigh,
		TeamID:      "team-1",
		Labels:      []string{"go", "backend"},
		Metadata:    map[string]string{"key": "val"},
	}
	id, err := store.Create(task)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if id == "" {
		t.Fatal("Create returned empty ID")
	}
	if task.ID != id {
		t.Errorf("task.ID = %q, want %q", task.ID, id)
	}

	got, err := store.Get(id)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Title != task.Title {
		t.Errorf("Title = %q, want %q", got.Title, task.Title)
	}
	if got.Status != StatusPending {
		t.Errorf("Status = %q, want %q", got.Status, StatusPending)
	}
	if len(got.Labels) != 2 || got.Labels[0] != "go" {
		t.Errorf("Labels = %v, want [go backend]", got.Labels)
	}
	if got.Metadata["key"] != "val" {
		t.Errorf("Metadata key = %q, want %q", got.Metadata["key"], "val")
	}
}

func TestSQLiteStore_Update(t *testing.T) {
	store := newTestStore(t)

	task := &Task{Title: "orig", Description: "desc", Status: StatusPending}
	id, err := store.Create(task)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	task.Title = "updated"
	task.Status = StatusInProgress
	task.Result = "partial result"
	if err := store.Update(task); err != nil {
		t.Fatalf("Update: %v", err)
	}

	got, err := store.Get(id)
	if err != nil {
		t.Fatalf("Get after update: %v", err)
	}
	if got.Title != "updated" {
		t.Errorf("Title = %q, want updated", got.Title)
	}
	if got.Status != StatusInProgress {
		t.Errorf("Status = %q, want in_progress", got.Status)
	}
	if got.Result != "partial result" {
		t.Errorf("Result = %q, want partial result", got.Result)
	}
}

func TestSQLiteStore_Update_NotFound(t *testing.T) {
	store := newTestStore(t)
	task := &Task{ID: "nonexistent", Title: "x", Description: "y", Status: StatusPending}
	if err := store.Update(task); err == nil {
		t.Fatal("expected error updating non-existent task")
	}
}

func TestSQLiteStore_Delete(t *testing.T) {
	store := newTestStore(t)

	task := &Task{Title: "to delete", Description: "desc", Status: StatusPending}
	id, err := store.Create(task)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := store.Delete(id); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	if _, err := store.Get(id); err == nil {
		t.Fatal("expected error getting deleted task")
	}
}

func TestSQLiteStore_Delete_NotFound(t *testing.T) {
	store := newTestStore(t)
	if err := store.Delete("nonexistent"); err == nil {
		t.Fatal("expected error deleting non-existent task")
	}
}

func TestSQLiteStore_List(t *testing.T) {
	store := newTestStore(t)

	tasks := []*Task{
		{Title: "t1", Description: "d", Status: StatusPending, TeamID: "team-a", AssignedTo: "agent-1"},
		{Title: "t2", Description: "d", Status: StatusCompleted, TeamID: "team-a", AssignedTo: "agent-2"},
		{Title: "t3", Description: "d", Status: StatusPending, TeamID: "team-b", AssignedTo: "agent-1"},
	}
	for _, task := range tasks {
		if _, err := store.Create(task); err != nil {
			t.Fatalf("Create: %v", err)
		}
	}

	// List all
	all, err := store.List(Filter{})
	if err != nil {
		t.Fatalf("List all: %v", err)
	}
	if len(all) != 3 {
		t.Errorf("List all: got %d, want 3", len(all))
	}

	// Filter by team
	teamA, err := store.List(Filter{TeamID: "team-a"})
	if err != nil {
		t.Fatalf("List team-a: %v", err)
	}
	if len(teamA) != 2 {
		t.Errorf("List team-a: got %d, want 2", len(teamA))
	}

	// Filter by status
	pending := StatusPending
	pendingList, err := store.List(Filter{Status: &pending})
	if err != nil {
		t.Fatalf("List pending: %v", err)
	}
	if len(pendingList) != 2 {
		t.Errorf("List pending: got %d, want 2", len(pendingList))
	}

	// Filter by assignee
	agent1, err := store.List(Filter{AssignedTo: "agent-1"})
	if err != nil {
		t.Fatalf("List agent-1: %v", err)
	}
	if len(agent1) != 2 {
		t.Errorf("List agent-1: got %d, want 2", len(agent1))
	}

	// Limit
	limited, err := store.List(Filter{Limit: 2})
	if err != nil {
		t.Fatalf("List limit: %v", err)
	}
	if len(limited) != 2 {
		t.Errorf("List limit 2: got %d, want 2", len(limited))
	}
}
