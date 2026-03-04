# Multi-Domain Expansion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand Ratchet from Operations-only to three additional domains (Development, Security, Data) with 7 new tools, 3 new pipelines, 5 scripted scenarios, 3 E2E tests, and a core learning loop demonstrating memory-driven improvement across agent execution cycles.

**Architecture:** Each domain follows the proven infra-monitor pattern: cron trigger → find agent → check not busy → step.set context → step.agent_execute → mark done. New tools implement the `provider.Tool` interface (Name/Description/Definition/Execute) and are registered in `plugin.go`'s `toolRegistryHook`. Learning loop uses existing `memory_search`/`memory_save` tools within scripted scenarios.

**Tech Stack:** Go 1.26 (stdlib + `os/exec` for tool binaries), SQLite (in-memory for tests), workflow engine pipeline YAML, bash E2E scripts.

---

## Task 1: Development Tools — `code_review`

**Files:**
- Create: `ratchetplugin/tools/code.go`
- Create: `ratchetplugin/tools/code_test.go`
- Modify: `ratchetplugin/plugin.go` (register new tools in `toolRegistryHook`)

**Step 1: Write the test file with tests for code_review tool**

```go
// ratchetplugin/tools/code_test.go
package tools

import (
	"context"
	"os"
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
	// Create a temp Go file with a known lint issue
	dir := t.TempDir()
	goFile := filepath.Join(dir, "main.go")
	// Unused variable will trigger lint
	err := os.WriteFile(goFile, []byte(`package main

func main() {
	x := 1
	_ = x
}
`), 0644)
	if err != nil {
		t.Fatal(err)
	}
	// Also create go.mod so it's a valid Go module
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
	// Should have findings key (may be empty if golangci-lint not installed)
	if _, ok := m["findings"]; !ok {
		t.Fatal("expected 'findings' key in result")
	}
	if _, ok := m["count"]; !ok {
		t.Fatal("expected 'count' key in result")
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
		// Either error or result with error field is acceptable
		return
	}
	m, ok := result.(map[string]any)
	if ok {
		if _, hasErr := m["error"]; hasErr {
			return // error field in result is fine
		}
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jon/workspace/ratchet && go test ./ratchetplugin/tools/ -run TestCodeReview -v`
Expected: FAIL with "undefined: CodeReviewTool"

**Step 3: Write the `code_review` tool implementation**

```go
// ratchetplugin/tools/code.go
package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/GoCodeAlone/ratchet/provider"
)

// CodeReviewTool runs golangci-lint on a Go project and returns structured findings.
type CodeReviewTool struct{}

func (t *CodeReviewTool) Name() string        { return "code_review" }
func (t *CodeReviewTool) Description() string  { return "Run static analysis (golangci-lint) on a Go project and return structured findings" }
func (t *CodeReviewTool) Definition() provider.ToolDef {
	return provider.ToolDef{
		Name:        "code_review",
		Description: "Run golangci-lint on a Go project path. Returns lint findings with severity, file, line, and message.",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"path": map[string]any{
					"type":        "string",
					"description": "Path to the Go project directory to review",
				},
			},
			"required": []string{"path"},
		},
	}
}

func (t *CodeReviewTool) Execute(ctx context.Context, args map[string]any) (any, error) {
	path, ok := args["path"].(string)
	if !ok || path == "" {
		return nil, fmt.Errorf("code_review: 'path' is required")
	}

	// Verify path exists
	if _, err := os.Stat(path); err != nil {
		return map[string]any{"error": fmt.Sprintf("path not found: %s", path), "findings": []any{}, "count": 0}, nil
	}

	// Check if golangci-lint is available
	lintPath, err := exec.LookPath("golangci-lint")
	if err != nil {
		// Fallback: run go vet
		return t.fallbackGoVet(ctx, path)
	}

	execCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	cmd := exec.CommandContext(execCtx, lintPath, "run", "--out-format", "json", "--timeout", "30s", "./...")
	cmd.Dir = path
	out, _ := cmd.CombinedOutput() // golangci-lint exits non-zero when findings exist

	return t.parseGolangciOutput(out, path)
}

func (t *CodeReviewTool) fallbackGoVet(ctx context.Context, path string) (any, error) {
	execCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(execCtx, "go", "vet", "./...")
	cmd.Dir = path
	out, _ := cmd.CombinedOutput()

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	findings := []map[string]any{}
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		findings = append(findings, map[string]any{
			"severity": "warning",
			"message":  line,
			"linter":   "go-vet",
		})
	}
	return map[string]any{
		"findings": findings,
		"count":    len(findings),
		"tool":     "go-vet-fallback",
	}, nil
}

func (t *CodeReviewTool) parseGolangciOutput(out []byte, basePath string) (any, error) {
	type lintIssue struct {
		FromLinter string `json:"FromLinter"`
		Text       string `json:"Text"`
		Severity   string `json:"Severity"`
		Pos        struct {
			Filename string `json:"Filename"`
			Line     int    `json:"Line"`
			Column   int    `json:"Column"`
		} `json:"Pos"`
	}
	type lintOutput struct {
		Issues []lintIssue `json:"Issues"`
	}

	var parsed lintOutput
	if err := json.Unmarshal(out, &parsed); err != nil {
		// If JSON parsing fails, return raw output
		return map[string]any{
			"findings": []any{},
			"count":    0,
			"raw":      string(out),
			"tool":     "golangci-lint",
		}, nil
	}

	findings := make([]map[string]any, 0, len(parsed.Issues))
	for _, issue := range parsed.Issues {
		relPath, _ := filepath.Rel(basePath, issue.Pos.Filename)
		if relPath == "" {
			relPath = issue.Pos.Filename
		}
		severity := issue.Severity
		if severity == "" {
			severity = "warning"
		}
		findings = append(findings, map[string]any{
			"severity": severity,
			"file":     relPath,
			"line":     issue.Pos.Line,
			"message":  issue.Text,
			"linter":   issue.FromLinter,
		})
	}

	return map[string]any{
		"findings": findings,
		"count":    len(findings),
		"tool":     "golangci-lint",
	}, nil
}

// CodeComplexityTool analyzes Go code complexity and identifies tech debt markers.
type CodeComplexityTool struct{}

func (t *CodeComplexityTool) Name() string        { return "code_complexity" }
func (t *CodeComplexityTool) Description() string  { return "Analyze Go code complexity (cyclomatic) and find TODO/FIXME/HACK markers" }
func (t *CodeComplexityTool) Definition() provider.ToolDef {
	return provider.ToolDef{
		Name:        "code_complexity",
		Description: "Analyze a Go project for cyclomatic complexity and tech debt markers (TODO, FIXME, HACK). Returns high-complexity functions and debt items.",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"path": map[string]any{
					"type":        "string",
					"description": "Path to the Go project directory",
				},
				"threshold": map[string]any{
					"type":        "number",
					"description": "Complexity threshold (default: 10)",
				},
			},
			"required": []string{"path"},
		},
	}
}

func (t *CodeComplexityTool) Execute(ctx context.Context, args map[string]any) (any, error) {
	path, ok := args["path"].(string)
	if !ok || path == "" {
		return nil, fmt.Errorf("code_complexity: 'path' is required")
	}

	threshold := 10
	if v, ok := args["threshold"].(float64); ok && v > 0 {
		threshold = int(v)
	}

	if _, err := os.Stat(path); err != nil {
		return map[string]any{"error": fmt.Sprintf("path not found: %s", path)}, nil
	}

	functions := t.findComplexFunctions(ctx, path, threshold)
	todos := t.findDebtMarkers(path)

	debtScore := len(functions)*3 + len(todos)

	return map[string]any{
		"functions":  functions,
		"todos":      todos,
		"debt_score": debtScore,
		"threshold":  threshold,
	}, nil
}

func (t *CodeComplexityTool) findComplexFunctions(ctx context.Context, path string, threshold int) []map[string]any {
	// Try gocyclo first
	gocycloPath, err := exec.LookPath("gocyclo")
	if err != nil {
		return []map[string]any{} // gocyclo not available
	}

	execCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(execCtx, gocycloPath, "-over", fmt.Sprintf("%d", threshold), path)
	out, _ := cmd.CombinedOutput()

	functions := []map[string]any{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// gocyclo output: "N path/file.go:line:col FuncName"
		parts := strings.Fields(line)
		if len(parts) >= 3 {
			functions = append(functions, map[string]any{
				"complexity": parts[0],
				"location":  parts[1],
				"name":      strings.Join(parts[2:], " "),
			})
		}
	}
	return functions
}

func (t *CodeComplexityTool) findDebtMarkers(path string) []map[string]any {
	markers := []map[string]any{}
	patterns := []string{"TODO", "FIXME", "HACK", "XXX", "DEPRECATED"}

	_ = filepath.Walk(path, func(fpath string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if !strings.HasSuffix(fpath, ".go") {
			return nil
		}
		data, err := os.ReadFile(fpath)
		if err != nil {
			return nil
		}
		for i, line := range strings.Split(string(data), "\n") {
			for _, pattern := range patterns {
				if strings.Contains(line, pattern) {
					relPath, _ := filepath.Rel(path, fpath)
					markers = append(markers, map[string]any{
						"file":    relPath,
						"line":    i + 1,
						"text":    strings.TrimSpace(line),
						"pattern": pattern,
					})
					break
				}
			}
		}
		return nil
	})
	return markers
}

// CodeDiffReviewTool runs git diff between two refs and structures the output.
type CodeDiffReviewTool struct{}

func (t *CodeDiffReviewTool) Name() string        { return "code_diff_review" }
func (t *CodeDiffReviewTool) Description() string  { return "Run git diff between two refs and return structured file changes" }
func (t *CodeDiffReviewTool) Definition() provider.ToolDef {
	return provider.ToolDef{
		Name:        "code_diff_review",
		Description: "Get a structured diff between two git refs (branches, commits, tags). Returns changed files with added/removed line counts.",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"repo_path": map[string]any{
					"type":        "string",
					"description": "Path to the git repository",
				},
				"base_ref": map[string]any{
					"type":        "string",
					"description": "Base ref (branch, commit, tag) to diff from",
				},
				"head_ref": map[string]any{
					"type":        "string",
					"description": "Head ref to diff to (default: HEAD)",
				},
			},
			"required": []string{"repo_path", "base_ref"},
		},
	}
}

func (t *CodeDiffReviewTool) Execute(ctx context.Context, args map[string]any) (any, error) {
	repoPath, ok := args["repo_path"].(string)
	if !ok || repoPath == "" {
		return nil, fmt.Errorf("code_diff_review: 'repo_path' is required")
	}
	baseRef, ok := args["base_ref"].(string)
	if !ok || baseRef == "" {
		return nil, fmt.Errorf("code_diff_review: 'base_ref' is required")
	}
	headRef, _ := args["head_ref"].(string)
	if headRef == "" {
		headRef = "HEAD"
	}

	execCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// Get diff stat
	diffRange := fmt.Sprintf("%s..%s", baseRef, headRef)
	cmd := exec.CommandContext(execCtx, "git", "diff", "--numstat", diffRange)
	cmd.Dir = repoPath
	out, err := cmd.CombinedOutput()
	if err != nil {
		return map[string]any{"error": fmt.Sprintf("git diff failed: %s", string(out))}, nil
	}

	files := []map[string]any{}
	totalAdded, totalRemoved := 0, 0
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) >= 3 {
			added, removed := 0, 0
			if parts[0] != "-" {
				fmt.Sscanf(parts[0], "%d", &added)
			}
			if parts[1] != "-" {
				fmt.Sscanf(parts[1], "%d", &removed)
			}
			files = append(files, map[string]any{
				"path":    parts[2],
				"added":   added,
				"removed": removed,
			})
			totalAdded += added
			totalRemoved += removed
		}
	}

	return map[string]any{
		"files":         files,
		"file_count":    len(files),
		"total_added":   totalAdded,
		"total_removed": totalRemoved,
		"base_ref":      baseRef,
		"head_ref":      headRef,
	}, nil
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/jon/workspace/ratchet && go test ./ratchetplugin/tools/ -run TestCodeReview -v`
Expected: PASS

**Step 5: Add tests for code_complexity and code_diff_review**

Add to `code_test.go`:

```go
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
	// Create a Go file with a TODO marker
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
	dir := setupGitRepo(t)

	// Create a file and commit on main
	err := os.WriteFile(filepath.Join(dir, "file.txt"), []byte("hello\n"), 0644)
	if err != nil {
		t.Fatal(err)
	}
	gitExec(t, dir, "add", "file.txt")
	gitExec(t, dir, "commit", "-m", "add file")

	// Create a branch, modify file, commit
	gitExec(t, dir, "checkout", "-b", "feature")
	err = os.WriteFile(filepath.Join(dir, "file.txt"), []byte("hello\nworld\n"), 0644)
	if err != nil {
		t.Fatal(err)
	}
	gitExec(t, dir, "add", "file.txt")
	gitExec(t, dir, "commit", "-m", "modify file")

	tool := &CodeDiffReviewTool{}
	result, err := tool.Execute(context.Background(), map[string]any{
		"repo_path": dir,
		"base_ref":  "main",
		"head_ref":  "feature",
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

// helper for git commands in tests
func gitExec(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v failed: %s: %v", args, out, err)
	}
}
```

**Step 6: Run all code tool tests**

Run: `cd /Users/jon/workspace/ratchet && go test ./ratchetplugin/tools/ -run "TestCode" -v`
Expected: PASS

**Step 7: Register tools in plugin.go**

In `ratchetplugin/plugin.go`, inside `toolRegistryHook`, add after the existing tool registrations:

```go
// Development tools
registry.Register(&tools.CodeReviewTool{})
registry.Register(&tools.CodeComplexityTool{})
registry.Register(&tools.CodeDiffReviewTool{})
```

**Step 8: Run full test suite**

Run: `cd /Users/jon/workspace/ratchet && go test ./... -count=1`
Expected: PASS

**Step 9: Commit**

```bash
git add ratchetplugin/tools/code.go ratchetplugin/tools/code_test.go ratchetplugin/plugin.go
git commit -m "feat: add development tools — code_review, code_complexity, code_diff_review"
```

---

## Task 2: Security Tools — `security_scan` and `vuln_check`

**Files:**
- Create: `ratchetplugin/tools/security.go`
- Create: `ratchetplugin/tools/security_test.go`
- Modify: `ratchetplugin/plugin.go`

**Step 1: Write tests for security tools**

```go
// ratchetplugin/tools/security_test.go
package tools

import (
	"context"
	"testing"
)

func TestSecurityScanTool_Definition(t *testing.T) {
	tool := &SecurityScanTool{}
	if tool.Name() != "security_scan" {
		t.Fatalf("expected name security_scan, got %s", tool.Name())
	}
	def := tool.Definition()
	if def.Name != "security_scan" {
		t.Fatalf("expected def name security_scan, got %s", def.Name)
	}
}

func TestSecurityScanTool_Execute(t *testing.T) {
	// SecurityScanTool uses a callback function to run the audit
	// In tests, provide a mock callback
	tool := &SecurityScanTool{
		RunAudit: func(ctx context.Context) (map[string]any, error) {
			return map[string]any{
				"score": 85,
				"summary": map[string]int{
					"high":   1,
					"medium": 2,
				},
				"findings": []map[string]any{
					{"check": "auth", "severity": "high", "title": "Default credentials detected"},
					{"check": "cors", "severity": "medium", "title": "Wildcard CORS origin"},
					{"check": "rate_limit", "severity": "medium", "title": "No rate limiting configured"},
				},
			}, nil
		},
	}
	result, err := tool.Execute(context.Background(), map[string]any{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m, ok := result.(map[string]any)
	if !ok {
		t.Fatal("expected map result")
	}
	if m["score"] != 85 {
		t.Fatalf("expected score 85, got %v", m["score"])
	}
}

func TestVulnCheckTool_Definition(t *testing.T) {
	tool := &VulnCheckTool{}
	if tool.Name() != "vuln_check" {
		t.Fatalf("expected name vuln_check, got %s", tool.Name())
	}
	def := tool.Definition()
	params, ok := def.Parameters["properties"].(map[string]any)
	if !ok {
		t.Fatal("expected properties map")
	}
	if _, ok := params["module_path"]; !ok {
		t.Fatal("expected 'module_path' parameter")
	}
}

func TestVulnCheckTool_Execute_MissingPath(t *testing.T) {
	tool := &VulnCheckTool{}
	_, err := tool.Execute(context.Background(), map[string]any{})
	if err == nil {
		t.Fatal("expected error for missing module_path")
	}
}
```

**Step 2: Run tests to verify failure**

Run: `cd /Users/jon/workspace/ratchet && go test ./ratchetplugin/tools/ -run "TestSecurity\|TestVuln" -v`
Expected: FAIL

**Step 3: Write security tool implementations**

```go
// ratchetplugin/tools/security.go
package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/GoCodeAlone/ratchet/provider"
)

// SecurityScanTool runs a platform security audit and returns structured findings.
type SecurityScanTool struct {
	// RunAudit is a callback injected at registration time that calls SecurityAuditor.RunAll().
	// This avoids importing the full auditor into the tools package.
	RunAudit func(ctx context.Context) (map[string]any, error)
}

func (t *SecurityScanTool) Name() string        { return "security_scan" }
func (t *SecurityScanTool) Description() string  { return "Run a platform security audit (12-point assessment) and return findings" }
func (t *SecurityScanTool) Definition() provider.ToolDef {
	return provider.ToolDef{
		Name:        "security_scan",
		Description: "Run a comprehensive security audit on the Ratchet platform. Returns findings categorized by severity (critical, high, medium, low, info) with a security score (0-100).",
		Parameters: map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		},
	}
}

func (t *SecurityScanTool) Execute(ctx context.Context, _ map[string]any) (any, error) {
	if t.RunAudit == nil {
		return map[string]any{"error": "security audit not configured", "score": 0, "findings": []any{}}, nil
	}
	return t.RunAudit(ctx)
}

// VulnCheckTool runs govulncheck on a Go module to find known vulnerabilities.
type VulnCheckTool struct{}

func (t *VulnCheckTool) Name() string        { return "vuln_check" }
func (t *VulnCheckTool) Description() string  { return "Check Go module dependencies for known vulnerabilities using govulncheck" }
func (t *VulnCheckTool) Definition() provider.ToolDef {
	return provider.ToolDef{
		Name:        "vuln_check",
		Description: "Run govulncheck on a Go module to find known CVEs in dependencies. Returns vulnerability list with severity and fix versions.",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"module_path": map[string]any{
					"type":        "string",
					"description": "Path to the Go module directory (must contain go.mod)",
				},
			},
			"required": []string{"module_path"},
		},
	}
}

func (t *VulnCheckTool) Execute(ctx context.Context, args map[string]any) (any, error) {
	modulePath, ok := args["module_path"].(string)
	if !ok || modulePath == "" {
		return nil, fmt.Errorf("vuln_check: 'module_path' is required")
	}

	// Check if govulncheck is available
	vulnPath, err := exec.LookPath("govulncheck")
	if err != nil {
		return map[string]any{
			"error":           "govulncheck not installed (go install golang.org/x/vuln/cmd/govulncheck@latest)",
			"vulnerabilities": []any{},
			"count":           0,
		}, nil
	}

	execCtx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()

	cmd := exec.CommandContext(execCtx, vulnPath, "-json", "./...")
	cmd.Dir = modulePath
	out, _ := cmd.CombinedOutput()

	return t.parseVulnOutput(out)
}

func (t *VulnCheckTool) parseVulnOutput(out []byte) (any, error) {
	// govulncheck -json outputs newline-delimited JSON objects
	vulns := []map[string]any{}
	decoder := json.NewDecoder(strings.NewReader(string(out)))
	for decoder.More() {
		var entry map[string]any
		if err := decoder.Decode(&entry); err != nil {
			break
		}
		// Look for "finding" entries which contain actual vulnerabilities
		if finding, ok := entry["finding"].(map[string]any); ok {
			osv, _ := finding["osv"].(string)
			vulns = append(vulns, map[string]any{
				"id":      osv,
				"finding": finding,
			})
		}
		// Look for "osv" entries for full vulnerability details
		if osv, ok := entry["osv"].(map[string]any); ok {
			id, _ := osv["id"].(string)
			summary, _ := osv["summary"].(string)
			vulns = append(vulns, map[string]any{
				"id":      id,
				"summary": summary,
				"details": osv,
			})
		}
	}

	if len(vulns) == 0 && len(out) > 0 {
		// If we couldn't parse JSON, return raw
		return map[string]any{
			"vulnerabilities": []any{},
			"count":           0,
			"raw":             string(out),
		}, nil
	}

	return map[string]any{
		"vulnerabilities": vulns,
		"count":           len(vulns),
	}, nil
}
```

**Step 4: Run tests**

Run: `cd /Users/jon/workspace/ratchet && go test ./ratchetplugin/tools/ -run "TestSecurity\|TestVuln" -v`
Expected: PASS

**Step 5: Register in plugin.go and wire security_scan callback**

In `plugin.go` `toolRegistryHook`, add:

```go
// Security tools
registry.Register(&tools.VulnCheckTool{})

// Security scan tool — wire the audit callback
if db != nil {
    registry.Register(&tools.SecurityScanTool{
        RunAudit: func(ctx context.Context) (map[string]any, error) {
            auditor := NewSecurityAuditor(db, app)
            report := auditor.RunAll(ctx)
            findings := make([]map[string]any, 0, len(report.Findings))
            for _, f := range report.Findings {
                findings = append(findings, map[string]any{
                    "check":       f.Check,
                    "severity":    string(f.Severity),
                    "title":       f.Title,
                    "description": f.Description,
                    "remediation": f.Remediation,
                })
            }
            summary := map[string]int{}
            for sev, count := range report.Summary {
                summary[string(sev)] = count
            }
            return map[string]any{
                "score":    report.Score,
                "summary":  summary,
                "findings": findings,
            }, nil
        },
    })
}
```

**Step 6: Run full test suite**

Run: `cd /Users/jon/workspace/ratchet && go test ./... -count=1`
Expected: PASS

**Step 7: Commit**

```bash
git add ratchetplugin/tools/security.go ratchetplugin/tools/security_test.go ratchetplugin/plugin.go
git commit -m "feat: add security tools — security_scan, vuln_check"
```

---

## Task 3: Data Tools — `db_analyze` and `db_health_check`

**Files:**
- Create: `ratchetplugin/tools/data.go`
- Create: `ratchetplugin/tools/data_test.go`
- Modify: `ratchetplugin/plugin.go`

**Step 1: Write tests**

```go
// ratchetplugin/tools/data_test.go
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
	// Insert test data
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
```

**Step 2: Run tests to verify failure**

Run: `cd /Users/jon/workspace/ratchet && go test ./ratchetplugin/tools/ -run "TestDB" -v`
Expected: FAIL

**Step 3: Write data tool implementations**

```go
// ratchetplugin/tools/data.go
package tools

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/GoCodeAlone/ratchet/provider"
)

// DBAnalyzeTool runs EXPLAIN QUERY PLAN on SQL queries for optimization analysis.
type DBAnalyzeTool struct {
	DB *sql.DB
}

func (t *DBAnalyzeTool) Name() string        { return "db_analyze" }
func (t *DBAnalyzeTool) Description() string  { return "Analyze SQL query execution plans to identify optimization opportunities" }
func (t *DBAnalyzeTool) Definition() provider.ToolDef {
	return provider.ToolDef{
		Name:        "db_analyze",
		Description: "Run EXPLAIN QUERY PLAN on a SQL query to analyze execution strategy. Identifies full table scans, index usage, and estimated cost.",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{
					"type":        "string",
					"description": "The SQL SELECT query to analyze",
				},
			},
			"required": []string{"query"},
		},
	}
}

func (t *DBAnalyzeTool) Execute(_ context.Context, args map[string]any) (any, error) {
	query, ok := args["query"].(string)
	if !ok || query == "" {
		return nil, fmt.Errorf("db_analyze: 'query' is required")
	}

	if t.DB == nil {
		return map[string]any{"error": "database not configured"}, nil
	}

	// Only allow SELECT queries for safety
	normalized := strings.TrimSpace(strings.ToUpper(query))
	if !strings.HasPrefix(normalized, "SELECT") {
		return map[string]any{"error": "only SELECT queries can be analyzed"}, nil
	}

	rows, err := t.DB.Query("EXPLAIN QUERY PLAN " + query)
	if err != nil {
		return map[string]any{"error": fmt.Sprintf("explain failed: %v", err)}, nil
	}
	defer rows.Close()

	planLines := []string{}
	fullScan := false
	indexUsed := ""

	for rows.Next() {
		var id, parent, notused int
		var detail string
		if err := rows.Scan(&id, &parent, &notused, &detail); err != nil {
			continue
		}
		planLines = append(planLines, detail)
		if strings.Contains(strings.ToUpper(detail), "SCAN") {
			fullScan = true
		}
		if strings.Contains(strings.ToUpper(detail), "INDEX") {
			parts := strings.Fields(detail)
			for i, p := range parts {
				if strings.ToUpper(p) == "INDEX" && i+1 < len(parts) {
					indexUsed = parts[i+1]
				}
			}
		}
	}

	return map[string]any{
		"plan":       strings.Join(planLines, "\n"),
		"full_scan":  fullScan,
		"index_used": indexUsed,
		"query":      query,
	}, nil
}

// DBHealthCheckTool checks SQLite database health metrics.
type DBHealthCheckTool struct {
	DB *sql.DB
}

func (t *DBHealthCheckTool) Name() string        { return "db_health_check" }
func (t *DBHealthCheckTool) Description() string  { return "Check database health: integrity, size, table stats, and free space" }
func (t *DBHealthCheckTool) Definition() provider.ToolDef {
	return provider.ToolDef{
		Name:        "db_health_check",
		Description: "Run SQLite health checks: integrity verification, page counts, free pages, and per-table row counts.",
		Parameters: map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		},
	}
}

func (t *DBHealthCheckTool) Execute(_ context.Context, _ map[string]any) (any, error) {
	if t.DB == nil {
		return map[string]any{"error": "database not configured"}, nil
	}

	// Integrity check
	var integrity string
	_ = t.DB.QueryRow("PRAGMA integrity_check").Scan(&integrity)

	// Page stats
	var pageCount, freePages, pageSize int
	_ = t.DB.QueryRow("PRAGMA page_count").Scan(&pageCount)
	_ = t.DB.QueryRow("PRAGMA freelist_count").Scan(&freePages)
	_ = t.DB.QueryRow("PRAGMA page_size").Scan(&pageSize)

	sizeBytes := pageCount * pageSize

	// Table row counts
	tables := []map[string]any{}
	rows, err := t.DB.Query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				continue
			}
			var count int
			_ = t.DB.QueryRow(fmt.Sprintf("SELECT COUNT(*) FROM \"%s\"", name)).Scan(&count)
			tables = append(tables, map[string]any{
				"name":      name,
				"row_count": count,
			})
		}
	}

	return map[string]any{
		"integrity":  integrity,
		"pages":      pageCount,
		"free_pages": freePages,
		"page_size":  pageSize,
		"size_bytes": sizeBytes,
		"tables":     tables,
	}, nil
}
```

**Step 4: Run tests**

Run: `cd /Users/jon/workspace/ratchet && go test ./ratchetplugin/tools/ -run "TestDB" -v`
Expected: PASS

**Step 5: Register in plugin.go**

```go
// Data tools
if db != nil {
    registry.Register(&tools.DBAnalyzeTool{DB: db})
    registry.Register(&tools.DBHealthCheckTool{DB: db})
}
```

**Step 6: Run full test suite**

Run: `cd /Users/jon/workspace/ratchet && go test ./... -count=1`
Expected: PASS

**Step 7: Commit**

```bash
git add ratchetplugin/tools/data.go ratchetplugin/tools/data_test.go ratchetplugin/plugin.go
git commit -m "feat: add data tools — db_analyze, db_health_check"
```

---

## Task 4: New Agents and Pipeline Configs

**Files:**
- Modify: `config/modules.yaml` — add 3 new seeded agents
- Create: `config/pipelines-dev.yaml` — dev-review pipeline
- Create: `config/pipelines-security.yaml` — security-monitor pipeline
- Create: `config/pipelines-data.yaml` — data-monitor pipeline
- Modify: `config/triggers.yaml` — add 3 new cron triggers
- Modify: `ratchet.yaml` — import new pipeline files

**Step 1: Add new agents to modules.yaml**

In the `ratchet-ai` module's `agents:` list (after `infrawatch`), add:

```yaml
      - id: devreview
        name: DevReview
        role: development
        system_prompt: "You are an autonomous code review agent. Analyze Go codebases for quality issues, complexity hotspots, and technical debt. Track recurring patterns in memory and recommend automation for frequently-seen issues."
        provider: ""
        model: ""
        team_id: ""
        is_lead: false
      - id: securityguard
        name: SecurityGuard
        role: security
        system_prompt: "You are an autonomous security compliance agent. Run platform security audits, scan for dependency vulnerabilities, and track remediation status over time. Use memory to identify recurring vulnerabilities and prioritize fixes."
        provider: ""
        model: ""
        team_id: ""
        is_lead: false
      - id: dataanalyst
        name: DataAnalyst
        role: data
        system_prompt: "You are an autonomous database health agent. Monitor database integrity, analyze query performance, identify optimization opportunities, and track recommendations over time. Use memory to track which optimizations were effective."
        provider: ""
        model: ""
        team_id: ""
        is_lead: false
```

**Step 2: Create pipelines-dev.yaml**

```yaml
# Development Review Pipeline
# Periodic code review and tech debt analysis by the development agent.

pipelines:
  dev-review:
    description: "Periodic code review and tech debt analysis"
    steps:
      - name: find-dev-agent
        type: step.db_query
        config:
          database: ratchet-db
          query: >
            SELECT id, name, system_prompt, provider FROM agents
            WHERE role = 'development' AND status != 'stopped'
            ORDER BY created_at ASC LIMIT 1
          mode: single

      - name: check-agent-exists
        type: step.conditional
        config:
          field: "steps.find-dev-agent.found"
          routes:
            "false": no-dev-agent
          default: check-busy

      - name: check-busy
        type: step.db_query
        config:
          database: ratchet-db
          query: >
            SELECT COUNT(*) as busy FROM tasks
            WHERE assigned_to = ? AND status = 'in_progress'
          params:
            - '{{ step "find-dev-agent" "row" "id" }}'
          mode: single

      - name: check-not-busy
        type: step.conditional
        config:
          field: "steps.check-busy.row.busy"
          routes:
            "0": create-review-task
          default: agent-busy

      - name: create-review-task
        type: step.db_exec
        config:
          database: ratchet-db
          query: >
            INSERT INTO tasks (id, title, description, status, priority, assigned_to, created_at, updated_at)
            VALUES (lower(hex(randomblob(16))), 'Code Review', 'Run a comprehensive code review. Analyze for lint issues, complexity hotspots, and tech debt markers. Check memory for previously identified patterns and track new findings.', 'pending', 3, ?, datetime('now'), datetime('now'))
          params:
            - '{{ step "find-dev-agent" "row" "id" }}'

      - name: prepare-agent-context
        type: step.set
        config:
          values:
            agent_id: '{{ step "find-dev-agent" "row" "id" }}'
            agent_name: '{{ step "find-dev-agent" "row" "name" }}'
            system_prompt: '{{ step "find-dev-agent" "row" "system_prompt" }}'
            task: >
              Run a comprehensive code review on the current codebase. Use code_review to check for lint
              issues, code_complexity to find hotspots and tech debt markers. Check memory_search for
              previously identified patterns. Save new findings with memory_save. Report a structured
              summary noting any recurring patterns.

      - name: execute-dev-agent
        type: step.agent_execute
        config:
          max_iterations: 15
          provider_service: ratchet-ai
          approval_timeout: "10m"
          loop_detection:
            max_consecutive: 3
            max_errors: 2

      - name: mark-task-done
        type: step.db_exec
        config:
          database: ratchet-db
          query: >
            UPDATE tasks SET status = 'completed',
            result = ?, completed_at = datetime('now'), updated_at = datetime('now')
            WHERE assigned_to = ? AND title = 'Code Review' AND status = 'pending'
          params:
            - '{{ step "execute-dev-agent" "result" | default "completed" }}'
            - '{{ step "find-dev-agent" "row" "id" }}'

      - name: log-result
        type: step.log
        config:
          message: "Code review complete for agent {{ step \"find-dev-agent\" \"row\" \"id\" }}"
          level: info

      - name: no-dev-agent
        type: step.log
        config:
          message: "dev-review: no development agent configured — skipping"
          level: debug

      - name: agent-busy
        type: step.log
        config:
          message: "dev-review: development agent is busy — skipping this cycle"
          level: debug
```

**Step 3: Create pipelines-security.yaml**

Same pattern as above, but for security role. Key differences:
- Agent role: `security`
- Task title: `Security Scan`
- Task description and system prompt reference security_scan, vuln_check tools

```yaml
# Security Monitoring Pipeline
# Periodic security audit and vulnerability scanning by the security agent.

pipelines:
  security-monitor:
    description: "Periodic security audit and vulnerability scanning"
    steps:
      - name: find-security-agent
        type: step.db_query
        config:
          database: ratchet-db
          query: >
            SELECT id, name, system_prompt, provider FROM agents
            WHERE role = 'security' AND status != 'stopped'
            ORDER BY created_at ASC LIMIT 1
          mode: single

      - name: check-agent-exists
        type: step.conditional
        config:
          field: "steps.find-security-agent.found"
          routes:
            "false": no-security-agent
          default: check-busy

      - name: check-busy
        type: step.db_query
        config:
          database: ratchet-db
          query: >
            SELECT COUNT(*) as busy FROM tasks
            WHERE assigned_to = ? AND status = 'in_progress'
          params:
            - '{{ step "find-security-agent" "row" "id" }}'
          mode: single

      - name: check-not-busy
        type: step.conditional
        config:
          field: "steps.check-busy.row.busy"
          routes:
            "0": create-scan-task
          default: agent-busy

      - name: create-scan-task
        type: step.db_exec
        config:
          database: ratchet-db
          query: >
            INSERT INTO tasks (id, title, description, status, priority, assigned_to, created_at, updated_at)
            VALUES (lower(hex(randomblob(16))), 'Security Scan', 'Run a comprehensive security audit and vulnerability scan. Check memory for previously found vulnerabilities and track remediation status.', 'pending', 4, ?, datetime('now'), datetime('now'))
          params:
            - '{{ step "find-security-agent" "row" "id" }}'

      - name: prepare-agent-context
        type: step.set
        config:
          values:
            agent_id: '{{ step "find-security-agent" "row" "id" }}'
            agent_name: '{{ step "find-security-agent" "row" "name" }}'
            system_prompt: '{{ step "find-security-agent" "row" "system_prompt" }}'
            task: >
              Run a comprehensive security assessment. Use security_scan to run the platform audit,
              vuln_check to scan for dependency vulnerabilities. Check memory_search for previously
              found vulnerabilities. Save new findings and status updates with memory_save. Report
              a structured summary with new, recurring, and resolved findings.

      - name: execute-security-agent
        type: step.agent_execute
        config:
          max_iterations: 10
          provider_service: ratchet-ai
          approval_timeout: "10m"
          loop_detection:
            max_consecutive: 3
            max_errors: 2

      - name: mark-task-done
        type: step.db_exec
        config:
          database: ratchet-db
          query: >
            UPDATE tasks SET status = 'completed',
            result = ?, completed_at = datetime('now'), updated_at = datetime('now')
            WHERE assigned_to = ? AND title = 'Security Scan' AND status = 'pending'
          params:
            - '{{ step "execute-security-agent" "result" | default "completed" }}'
            - '{{ step "find-security-agent" "row" "id" }}'

      - name: log-result
        type: step.log
        config:
          message: "Security scan complete for agent {{ step \"find-security-agent\" \"row\" \"id\" }}"
          level: info

      - name: no-security-agent
        type: step.log
        config:
          message: "security-monitor: no security agent configured — skipping"
          level: debug

      - name: agent-busy
        type: step.log
        config:
          message: "security-monitor: security agent is busy — skipping this cycle"
          level: debug
```

**Step 4: Create pipelines-data.yaml**

Same pattern for data role:

```yaml
# Data Monitoring Pipeline
# Periodic database health analysis by the data agent.

pipelines:
  data-monitor:
    description: "Periodic database health and query optimization analysis"
    steps:
      - name: find-data-agent
        type: step.db_query
        config:
          database: ratchet-db
          query: >
            SELECT id, name, system_prompt, provider FROM agents
            WHERE role = 'data' AND status != 'stopped'
            ORDER BY created_at ASC LIMIT 1
          mode: single

      - name: check-agent-exists
        type: step.conditional
        config:
          field: "steps.find-data-agent.found"
          routes:
            "false": no-data-agent
          default: check-busy

      - name: check-busy
        type: step.db_query
        config:
          database: ratchet-db
          query: >
            SELECT COUNT(*) as busy FROM tasks
            WHERE assigned_to = ? AND status = 'in_progress'
          params:
            - '{{ step "find-data-agent" "row" "id" }}'
          mode: single

      - name: check-not-busy
        type: step.conditional
        config:
          field: "steps.check-busy.row.busy"
          routes:
            "0": create-analysis-task
          default: agent-busy

      - name: create-analysis-task
        type: step.db_exec
        config:
          database: ratchet-db
          query: >
            INSERT INTO tasks (id, title, description, status, priority, assigned_to, created_at, updated_at)
            VALUES (lower(hex(randomblob(16))), 'Database Health Check', 'Run database health analysis. Check integrity, analyze query plans, identify optimization opportunities. Check memory for past recommendations.', 'pending', 2, ?, datetime('now'), datetime('now'))
          params:
            - '{{ step "find-data-agent" "row" "id" }}'

      - name: prepare-agent-context
        type: step.set
        config:
          values:
            agent_id: '{{ step "find-data-agent" "row" "id" }}'
            agent_name: '{{ step "find-data-agent" "row" "name" }}'
            system_prompt: '{{ step "find-data-agent" "row" "system_prompt" }}'
            task: >
              Run a database health analysis. Use db_health_check to assess overall database health.
              Use db_analyze on important queries to find optimization opportunities. Check memory_search
              for past recommendations. Save new findings and optimization recommendations with memory_save.
              Report a structured summary with health metrics and recommendations.

      - name: execute-data-agent
        type: step.agent_execute
        config:
          max_iterations: 10
          provider_service: ratchet-ai
          approval_timeout: "10m"
          loop_detection:
            max_consecutive: 3
            max_errors: 2

      - name: mark-task-done
        type: step.db_exec
        config:
          database: ratchet-db
          query: >
            UPDATE tasks SET status = 'completed',
            result = ?, completed_at = datetime('now'), updated_at = datetime('now')
            WHERE assigned_to = ? AND title = 'Database Health Check' AND status = 'pending'
          params:
            - '{{ step "execute-data-agent" "result" | default "completed" }}'
            - '{{ step "find-data-agent" "row" "id" }}'

      - name: log-result
        type: step.log
        config:
          message: "Database health check complete for agent {{ step \"find-data-agent\" \"row\" \"id\" }}"
          level: info

      - name: no-data-agent
        type: step.log
        config:
          message: "data-monitor: no data agent configured — skipping"
          level: debug

      - name: agent-busy
        type: step.log
        config:
          message: "data-monitor: data agent is busy — skipping this cycle"
          level: debug
```

**Step 5: Update triggers.yaml**

Add 3 new cron triggers:

```yaml
      - cron: "*/10 * * * *"
        workflow: "pipeline:dev-review"
        action: "code-review"
      - cron: "*/30 * * * *"
        workflow: "pipeline:security-monitor"
        action: "security-scan"
      - cron: "*/15 * * * *"
        workflow: "pipeline:data-monitor"
        action: "data-analysis"
```

**Step 6: Update ratchet.yaml**

Add imports for the 3 new pipeline files:

```yaml
  - config/pipelines-dev.yaml
  - config/pipelines-security.yaml
  - config/pipelines-data.yaml
```

**Step 7: Verify config loads**

Run: `cd /Users/jon/workspace/ratchet && go build -o bin/ratchetd ./cmd/ratchetd/ && ./bin/ratchetd --config ratchet.yaml &; sleep 3; curl -sf http://localhost:9090/api/status; kill %1`
Expected: `{"status":"ok",...}`

**Step 8: Commit**

```bash
git add config/modules.yaml config/pipelines-dev.yaml config/pipelines-security.yaml config/pipelines-data.yaml config/triggers.yaml ratchet.yaml
git commit -m "feat: add dev-review, security-monitor, data-monitor pipelines with seeded agents"
```

---

## Task 5: Scripted Scenarios — Development Learning Loop (3 Runs)

**Files:**
- Create: `testdata/scenarios/dev-review-run1.yaml`
- Create: `testdata/scenarios/dev-review-run2.yaml`
- Create: `testdata/scenarios/dev-review-run3.yaml`

**Step 1: Create run1 scenario (Discovery)**

```yaml
# testdata/scenarios/dev-review-run1.yaml
name: dev-review-run1-discovery
loop: false
description: >
  First code review run. Agent reviews code, finds issues, searches memory (empty),
  and saves new patterns. Demonstrates initial knowledge building.
steps:
  - content: "Running code review to analyze the codebase for quality issues."
    tool_calls:
      - name: code_review
        arguments:
          path: "."
  - content: "Found 3 lint issues. Let me check if these are recurring patterns."
    tool_calls:
      - name: memory_search
        arguments:
          query: "code review findings lint complexity"
          limit: 5
  - content: "No previous patterns found — this is a fresh review. Running complexity analysis."
    tool_calls:
      - name: code_complexity
        arguments:
          path: "."
          threshold: 10
  - content: "Found high cyclomatic complexity in handler functions. Saving all findings to memory for future reference."
    tool_calls:
      - name: memory_save
        arguments:
          content: "Code review finding: high cyclomatic complexity in HTTP handler functions (3 functions over threshold 10). Linter found unused variables and missing error checks. Pattern: handler functions accumulate complexity over time."
          category: "fact"
  - content: >
      Code Review Summary (Run 1 - Discovery):
      - 3 lint issues found (unused vars, missing error checks)
      - 1 complexity hotspot (handler functions over threshold)
      - 0 previous patterns in memory (fresh review)
      - All findings saved to memory for future tracking
```

**Step 2: Create run2 scenario (Recall)**

```yaml
# testdata/scenarios/dev-review-run2.yaml
name: dev-review-run2-recall
loop: false
description: >
  Second code review run. Agent finds similar issues, recalls patterns from memory,
  and produces a review referencing past findings. Demonstrates learning.
steps:
  - content: "Running code review to analyze the codebase for quality issues."
    tool_calls:
      - name: code_review
        arguments:
          path: "."
  - content: "Found 2 lint issues similar to previous findings. Checking memory for recurring patterns."
    tool_calls:
      - name: memory_search
        arguments:
          query: "code review findings lint complexity handler"
          limit: 5
  - content: "Memory confirms this is a recurring pattern — high complexity in handler functions was found in a previous review. Running complexity analysis to compare."
    tool_calls:
      - name: code_complexity
        arguments:
          path: "."
          threshold: 10
  - content: "Reinforcing the pattern in memory with updated count."
    tool_calls:
      - name: memory_save
        arguments:
          content: "Recurring pattern (seen 2x): high cyclomatic complexity in HTTP handler functions persists across reviews. Same lint issues (unused vars, missing error checks) found again. Recommend investigating automated linting in CI pipeline."
          category: "fact"
  - content: >
      Code Review Summary (Run 2 - Recall):
      - 2 lint issues found (recurring from previous review)
      - High complexity in handler functions — RECURRING PATTERN (seen 2x)
      - Memory recall: previous review identified same handler complexity pattern
      - Recommendation: Consider adding golangci-lint to CI pipeline for automated detection
```

**Step 3: Create run3 scenario (Skip Known)**

```yaml
# testdata/scenarios/dev-review-run3.yaml
name: dev-review-run3-skip-known
loop: false
description: >
  Third code review run. Agent recognizes well-known patterns from memory,
  recommends automation instead of manual review. Saves a decision.
steps:
  - content: "Running code review to analyze the codebase."
    tool_calls:
      - name: code_review
        arguments:
          path: "."
  - content: "Found similar lint issues. Checking memory — this might be a known pattern."
    tool_calls:
      - name: memory_search
        arguments:
          query: "recurring code review lint complexity handler automated"
          limit: 5
  - content: "Memory confirms this is a well-known recurring pattern (3x). Instead of reporting it again, I'm recording a decision to automate."
    tool_calls:
      - name: memory_save
        arguments:
          content: "DECISION: Automate golangci-lint checks in CI pipeline for handler complexity and lint issues. Pattern seen 3 times across reviews — manual review is no longer cost-effective for these known issues. Redirect review effort to architectural concerns instead."
          category: "decision"
  - content: >
      Code Review Summary (Run 3 - Skip Known):
      - Known recurring pattern detected (seen 3x): handler complexity + lint issues
      - DECISION RECORDED: Automate golangci-lint in CI pipeline
      - These findings no longer warrant manual review — automation recommended
      - Future reviews should focus on architectural concerns, not known lint patterns
```

**Step 4: Commit**

```bash
git add testdata/scenarios/dev-review-run1.yaml testdata/scenarios/dev-review-run2.yaml testdata/scenarios/dev-review-run3.yaml
git commit -m "feat: add dev-review learning loop scenarios (3-run progressive)"
```

---

## Task 6: Scripted Scenarios — Security and Data

**Files:**
- Create: `testdata/scenarios/security-scan.yaml`
- Create: `testdata/scenarios/data-analysis.yaml`

**Step 1: Create security scan scenario**

```yaml
# testdata/scenarios/security-scan.yaml
name: security-scan
loop: false
description: >
  Security agent runs platform audit and vulnerability check, consults memory
  for past vulnerabilities, and saves findings.
steps:
  - content: "Running platform security audit to assess overall security posture."
    tool_calls:
      - name: security_scan
        arguments: {}
  - content: "Audit complete. Now checking for dependency vulnerabilities."
    tool_calls:
      - name: vuln_check
        arguments:
          module_path: "."
  - content: "Checking memory for previously identified vulnerabilities."
    tool_calls:
      - name: memory_search
        arguments:
          query: "security vulnerability CVE audit finding"
          limit: 5
  - content: "Saving current findings for future tracking."
    tool_calls:
      - name: memory_save
        arguments:
          content: "Security scan results: Platform score 85/100. Found 1 high-severity finding (default credentials), 2 medium findings (CORS, rate limiting). No dependency CVEs detected. Remediation priority: address default credentials first."
          category: "fact"
  - content: >
      Security Scan Summary:
      - Platform security score: 85/100
      - High severity: 1 (default credentials detected)
      - Medium severity: 2 (wildcard CORS, no rate limiting)
      - Dependency vulnerabilities: 0
      - No previous findings in memory (first scan)
      - Priority: Address default credentials immediately
```

**Step 2: Create data analysis scenario**

```yaml
# testdata/scenarios/data-analysis.yaml
name: data-analysis
loop: false
description: >
  Data agent checks database health, analyzes query performance, consults memory
  for past optimization recommendations, and saves new findings.
steps:
  - content: "Running database health check to assess overall database status."
    tool_calls:
      - name: db_health_check
        arguments: {}
  - content: "Database integrity OK. Analyzing query performance for common queries."
    tool_calls:
      - name: db_analyze
        arguments:
          query: "SELECT * FROM tasks WHERE status = 'pending' AND assigned_to != '' ORDER BY priority DESC"
  - content: "Checking memory for past optimization recommendations."
    tool_calls:
      - name: memory_search
        arguments:
          query: "database optimization index query performance"
          limit: 5
  - content: "Found a full table scan on tasks. Saving optimization recommendation."
    tool_calls:
      - name: memory_save
        arguments:
          content: "Database optimization: tasks table query for pending assigned tasks performs a full table scan. Recommend adding index: CREATE INDEX idx_tasks_status_assigned ON tasks(status, assigned_to). Estimated improvement: eliminate full scan on frequently-run agent-tick query."
          category: "fact"
  - content: >
      Database Health Summary:
      - Integrity: OK
      - Full table scan detected on tasks query (status + assigned_to filter)
      - Recommendation: Add composite index on tasks(status, assigned_to)
      - No previous optimization history (first analysis)
      - Database size and free pages within normal range
```

**Step 3: Commit**

```bash
git add testdata/scenarios/security-scan.yaml testdata/scenarios/data-analysis.yaml
git commit -m "feat: add security-scan and data-analysis scripted scenarios"
```

---

## Task 7: E2E Test Scripts

**Files:**
- Create: `scripts/e2e-dev-review.sh`
- Create: `scripts/e2e-security-scan.sh`
- Create: `scripts/e2e-data-analysis.sh`

**Step 1: Create dev-review E2E test (with 3-run learning loop)**

This is the most complex E2E test. It runs 3 iterations to demonstrate progressive learning. Each run starts ratchet with a different scenario file but preserves the DB (and memory) across runs 2 and 3.

See design doc for flow. The script should:
1. Start ratchet with run1 scenario, wait for dev-review cron, verify completion + memory entries
2. Kill server, restart with run2 scenario (KEEP the DB), verify transcript references past findings
3. Kill server, restart with run3 scenario (KEEP the DB), verify transcript contains "decision" or "automate"

Key: The learning loop works because runs 2+3 share the DB from run 1. The scripted scenarios include `memory_search` calls that will find real entries from previous runs.

**Step 2: Create security-scan E2E test**

Simpler — single run. Start ratchet with security-scan scenario, wait for security-monitor cron (30 min — override to 1 min for test), verify completion and transcripts.

**Step 3: Create data-analysis E2E test**

Single run. Start ratchet with data-analysis scenario, wait for data-monitor cron, verify completion.

**Note:** All E2E scripts follow the pattern of `scripts/e2e-self-healing.sh`:
- Colored output (PASS/FAIL/INFO)
- Login → find agent → wait for cron → check task → check transcripts
- Cleanup on exit

**Step 4: Make scripts executable**

```bash
chmod +x scripts/e2e-dev-review.sh scripts/e2e-security-scan.sh scripts/e2e-data-analysis.sh
```

**Step 5: Commit**

```bash
git add scripts/e2e-dev-review.sh scripts/e2e-security-scan.sh scripts/e2e-data-analysis.sh
git commit -m "feat: add E2E test scripts for dev-review, security-scan, data-analysis"
```

---

## Task 8: Enhanced Infra-Monitor with Learning Loop

**Files:**
- Create: `testdata/scenarios/self-healing-rollback-with-memory.yaml`
- Modify: `config/pipelines-infra.yaml` (no change needed — agent already has memory tools)

**Step 1: Create enhanced self-healing scenario with memory**

```yaml
# testdata/scenarios/self-healing-rollback-with-memory.yaml
name: self-healing-rollback-with-memory
loop: false
description: >
  Enhanced self-healing scenario that includes memory search (check for past incidents)
  and memory save (record remediation outcome). Demonstrates the learning loop.
steps:
  - content: "Checking memory for past infrastructure incidents before running health check."
    tool_calls:
      - name: memory_search
        arguments:
          query: "infrastructure incident remediation rollback pod failure"
          limit: 5
  - content: "No relevant past incidents found. Running infrastructure health check."
    tool_calls:
      - name: infra_health_check
        arguments: {}
  - content: >
      Health check detected an unhealthy pod. Rolling back the deployment
      to the previous known-good revision.
    tool_calls:
      - name: k8s_rollback
        arguments:
          deployment: "infra-test-app"
          namespace: "default"
  - content: "Rollback initiated. Verifying pod health."
    tool_calls:
      - name: k8s_get_pods
        arguments:
          namespace: "default"
          selector: "app=infra-test-app"
  - content: "Saving remediation outcome to memory for future reference."
    tool_calls:
      - name: memory_save
        arguments:
          content: "Infrastructure incident resolved: infra-test-app had ImagePullBackOff due to nonexistent image. Remediation: kubectl rollback to previous revision restored service. Time to resolution: <1 minute. Root cause: bad image tag in deployment spec."
          category: "fact"
  - content: >
      Remediation complete. The infra-test-app deployment was rolled back from the
      failing revision to the previous stable revision. Pod is running normally.
      Outcome saved to memory for future incident correlation.
```

**Step 2: Commit**

```bash
git add testdata/scenarios/self-healing-rollback-with-memory.yaml
git commit -m "feat: add self-healing scenario with memory-based learning loop"
```

---

## Task 9: Build, Deploy, and Run All E2E Tests

**Step 1: Run full Go test suite**

Run: `cd /Users/jon/workspace/ratchet && go test ./... -count=1`
Expected: ALL PASS

**Step 2: Build ratchetd**

Run: `cd /Users/jon/workspace/ratchet && go build -o bin/ratchetd ./cmd/ratchetd/`
Expected: Build success

**Step 3: Run E2E self-healing test (verifies existing pipeline still works)**

```bash
rm -f data/ratchet.db
RATCHET_AI_PROVIDER=test RATCHET_AI_SCENARIO=testdata/scenarios/self-healing-rollback.yaml ./bin/ratchetd --config ratchet.yaml &
sleep 3
./scripts/e2e-self-healing.sh
kill %1
```
Expected: E2E SELF-HEALING TEST: PASSED

**Step 4: Run E2E dev-review test (learning loop)**

```bash
./scripts/e2e-dev-review.sh
```
Expected: E2E DEV-REVIEW TEST: PASSED (all 3 runs)

**Step 5: Run E2E security-scan test**

```bash
./scripts/e2e-security-scan.sh
```
Expected: E2E SECURITY-SCAN TEST: PASSED

**Step 6: Run E2E data-analysis test**

```bash
./scripts/e2e-data-analysis.sh
```
Expected: E2E DATA-ANALYSIS TEST: PASSED

**Step 7: Cross-compile and build Docker image**

```bash
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ratchetd-linux ./cmd/ratchetd/
eval $(minikube docker-env) && docker build -f Dockerfile.prebuilt -t ratchet-app:v17 .
```

**Step 8: Deploy to minikube**

```bash
kubectl set image deployment/ratchet ratchet=ratchet-app:v17 -n default
kubectl rollout status deployment/ratchet -n default --timeout=60s
```

**Step 9: Verify deployment**

```bash
curl -sf http://localhost:19090/api/status
```

**Step 10: Run Playwright QA**

Run the existing Playwright tests to ensure no regressions.

**Step 11: Commit and push**

```bash
git push origin main
```

---

## Task Summary

| Task | What | New Files | Estimated Steps |
|------|------|-----------|-----------------|
| 1 | Development tools (code_review, code_complexity, code_diff_review) | code.go, code_test.go | 9 |
| 2 | Security tools (security_scan, vuln_check) | security.go, security_test.go | 7 |
| 3 | Data tools (db_analyze, db_health_check) | data.go, data_test.go | 7 |
| 4 | Pipeline configs + agents + triggers | 3 pipeline yamls, modules.yaml, triggers.yaml | 8 |
| 5 | Dev-review learning loop scenarios (3 runs) | 3 scenario yamls | 4 |
| 6 | Security + data scenarios | 2 scenario yamls | 3 |
| 7 | E2E test scripts | 3 bash scripts | 5 |
| 8 | Enhanced self-healing with memory | 1 scenario yaml | 2 |
| 9 | Build, deploy, verify | — | 11 |
