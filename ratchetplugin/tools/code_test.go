package tools

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestCodeReviewTool_Definition(t *testing.T) {
	tool := &CodeReviewTool{}
	if tool.Name() != "code_review" {
		t.Fatalf("expected name code_review, got %s", tool.Name())
	}
	def := tool.Definition()
	if def.Name != "code_review" {
		t.Fatalf("expected def name code_review, got %s", def.Name)
	}
	params, ok := def.Parameters["properties"].(map[string]any)
	if !ok {
		t.Fatal("expected properties map")
	}
	if _, ok := params["path"]; !ok {
		t.Fatal("expected 'path' parameter")
	}
}

func TestCodeReviewTool_Execute(t *testing.T) {
	dir := t.TempDir()
	err := os.WriteFile(filepath.Join(dir, "main.go"), []byte(`package main

func main() {
	x := 1
	_ = x
}
`), 0644)
	if err != nil {
		t.Fatal(err)
	}
	err = os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module test\ngo 1.22\n"), 0644)
	if err != nil {
		t.Fatal(err)
	}

	tool := &CodeReviewTool{}
	result, err := tool.Execute(context.Background(), map[string]any{"path": dir})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m, ok := result.(map[string]any)
	if !ok {
		t.Fatal("expected map result")
	}
	if _, ok := m["findings"]; !ok {
		t.Fatal("expected 'findings' key in result")
	}
	if _, ok := m["count"]; !ok {
		t.Fatal("expected 'count' key in result")
	}
	if _, ok := m["passed"]; !ok {
		t.Fatal("expected 'passed' key in result")
	}
}

func TestCodeReviewTool_Execute_MissingPath(t *testing.T) {
	tool := &CodeReviewTool{}
	_, err := tool.Execute(context.Background(), map[string]any{})
	if err == nil {
		t.Fatal("expected error for missing path")
	}
}

func TestCodeReviewTool_Execute_InvalidPath(t *testing.T) {
	tool := &CodeReviewTool{}
	result, err := tool.Execute(context.Background(), map[string]any{"path": "/nonexistent/path/xyz"})
	if err != nil {
		return
	}
	m, ok := result.(map[string]any)
	if ok {
		if _, ok := m["error"]; ok {
			return
		}
	}
}

func TestCodeComplexityTool_Definition(t *testing.T) {
	tool := &CodeComplexityTool{}
	if tool.Name() != "code_complexity" {
		t.Fatalf("expected name code_complexity, got %s", tool.Name())
	}
	def := tool.Definition()
	params, ok := def.Parameters["properties"].(map[string]any)
	if !ok {
		t.Fatal("expected properties map")
	}
	if _, ok := params["path"]; !ok {
		t.Fatal("expected 'path' parameter")
	}
}

func TestCodeComplexityTool_Execute(t *testing.T) {
	dir := t.TempDir()
	err := os.WriteFile(filepath.Join(dir, "main.go"), []byte(`package main

// TODO: refactor this function
func main() {
	x := 1
	_ = x
}
`), 0644)
	if err != nil {
		t.Fatal(err)
	}

	tool := &CodeComplexityTool{}
	result, err := tool.Execute(context.Background(), map[string]any{"path": dir})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m, ok := result.(map[string]any)
	if !ok {
		t.Fatal("expected map result")
	}
	todos, ok := m["todos"].([]map[string]any)
	if !ok {
		t.Fatal("expected todos slice")
	}
	if len(todos) == 0 {
		t.Fatal("expected at least one TODO marker")
	}
	if todos[0]["pattern"] != "TODO" {
		t.Fatalf("expected TODO pattern, got %v", todos[0]["pattern"])
	}
}

func TestCodeComplexityTool_Execute_MissingPath(t *testing.T) {
	tool := &CodeComplexityTool{}
	_, err := tool.Execute(context.Background(), map[string]any{})
	if err == nil {
		t.Fatal("expected error for missing path")
	}
}

func TestCodeDiffReviewTool_Definition(t *testing.T) {
	tool := &CodeDiffReviewTool{}
	if tool.Name() != "code_diff_review" {
		t.Fatalf("expected name code_diff_review, got %s", tool.Name())
	}
}

func TestCodeDiffReviewTool_Execute(t *testing.T) {
	// setupGitRepo is defined in git_test.go — creates a repo with one initial commit.
	dir := setupGitRepo(t)

	// Create a feature branch and add a new file.
	gitRun(t, dir, "checkout", "-b", "feature")
	err := os.WriteFile(filepath.Join(dir, "feature.txt"), []byte("hello\nworld\n"), 0644)
	if err != nil {
		t.Fatal(err)
	}
	gitRun(t, dir, "add", "feature.txt")
	gitRun(t, dir, "commit", "-m", "add feature file")

	tool := &CodeDiffReviewTool{}
	result, err := tool.Execute(context.Background(), map[string]any{
		"repo_path": dir,
		"base_ref":  "HEAD~1",
		"head_ref":  "HEAD",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m, ok := result.(map[string]any)
	if !ok {
		t.Fatal("expected map result")
	}
	if m["file_count"].(int) != 1 {
		t.Fatalf("expected 1 file changed, got %v", m["file_count"])
	}
}

func TestCodeDiffReviewTool_Execute_MissingArgs(t *testing.T) {
	tool := &CodeDiffReviewTool{}
	_, err := tool.Execute(context.Background(), map[string]any{})
	if err == nil {
		t.Fatal("expected error for missing repo_path")
	}
	_, err = tool.Execute(context.Background(), map[string]any{"repo_path": "/tmp"})
	if err == nil {
		t.Fatal("expected error for missing base_ref")
	}
}

// gitRun runs a git command in dir, failing the test on error.
func gitRun(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v failed: %s: %v", args, out, err)
	}
}
