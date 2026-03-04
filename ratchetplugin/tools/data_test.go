package tools

import (
	"context"
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func setupDataDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })

	_, err = db.Exec(`CREATE TABLE test_table (
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		value REAL
	)`)
	if err != nil {
		t.Fatalf("create table: %v", err)
	}
	for i := 0; i < 100; i++ {
		_, _ = db.Exec("INSERT INTO test_table (name, value) VALUES (?, ?)", "item", float64(i))
	}
	return db
}

func TestDBAnalyzeTool_Definition(t *testing.T) {
	tool := &DBAnalyzeTool{}
	if tool.Name() != "db_analyze" {
		t.Fatalf("expected name db_analyze, got %s", tool.Name())
	}
}

func TestDBAnalyzeTool_Execute(t *testing.T) {
	db := setupDataDB(t)
	tool := &DBAnalyzeTool{DB: db}
	result, err := tool.Execute(context.Background(), map[string]any{
		"query": "SELECT * FROM test_table WHERE name = 'item'",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m, ok := result.(map[string]any)
	if !ok {
		t.Fatal("expected map result")
	}
	if _, ok := m["plan"]; !ok {
		t.Fatal("expected 'plan' key in result")
	}
}

func TestDBAnalyzeTool_Execute_MissingQuery(t *testing.T) {
	db := setupDataDB(t)
	tool := &DBAnalyzeTool{DB: db}
	_, err := tool.Execute(context.Background(), map[string]any{})
	if err == nil {
		t.Fatal("expected error for missing query")
	}
}

func TestDBAnalyzeTool_Execute_NonSelect(t *testing.T) {
	db := setupDataDB(t)
	tool := &DBAnalyzeTool{DB: db}
	result, err := tool.Execute(context.Background(), map[string]any{
		"query": "DELETE FROM test_table",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m, ok := result.(map[string]any)
	if !ok {
		t.Fatal("expected map result")
	}
	if _, ok := m["error"]; !ok {
		t.Fatal("expected error for non-SELECT query")
	}
}

func TestDBHealthCheckTool_Definition(t *testing.T) {
	tool := &DBHealthCheckTool{}
	if tool.Name() != "db_health_check" {
		t.Fatalf("expected name db_health_check, got %s", tool.Name())
	}
}

func TestDBHealthCheckTool_Execute(t *testing.T) {
	db := setupDataDB(t)
	tool := &DBHealthCheckTool{DB: db}
	result, err := tool.Execute(context.Background(), map[string]any{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m, ok := result.(map[string]any)
	if !ok {
		t.Fatal("expected map result")
	}
	if _, ok := m["integrity"]; !ok {
		t.Fatal("expected 'integrity' key")
	}
	tables, ok := m["tables"].([]map[string]any)
	if !ok {
		t.Fatal("expected 'tables' slice")
	}
	if len(tables) == 0 {
		t.Fatal("expected at least one table")
	}
}

func TestDBHealthCheckTool_Execute_NilDB(t *testing.T) {
	tool := &DBHealthCheckTool{}
	result, err := tool.Execute(context.Background(), map[string]any{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m, ok := result.(map[string]any)
	if !ok {
		t.Fatal("expected map result")
	}
	if _, ok := m["error"]; !ok {
		t.Fatal("expected error key when no DB")
	}
}
