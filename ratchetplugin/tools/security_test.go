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
				"passed_count": 9,
				"failed_count": 3,
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

func TestSecurityScanTool_Execute_NoCallback(t *testing.T) {
	tool := &SecurityScanTool{}
	result, err := tool.Execute(context.Background(), map[string]any{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m, ok := result.(map[string]any)
	if !ok {
		t.Fatal("expected map result")
	}
	if _, ok := m["error"]; !ok {
		t.Fatal("expected error key when no callback configured")
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
