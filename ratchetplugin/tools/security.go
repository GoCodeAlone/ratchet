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

func (t *SecurityScanTool) Name() string { return "security_scan" }
func (t *SecurityScanTool) Description() string {
	return "Run a platform security audit (12-point assessment) and return findings"
}
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

func (t *VulnCheckTool) Name() string { return "vuln_check" }
func (t *VulnCheckTool) Description() string {
	return "Check Go module dependencies for known vulnerabilities using govulncheck"
}
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
	vulns := []map[string]any{}
	decoder := json.NewDecoder(strings.NewReader(string(out)))
	for decoder.More() {
		var entry map[string]any
		if err := decoder.Decode(&entry); err != nil {
			break
		}
		if finding, ok := entry["finding"].(map[string]any); ok {
			osv, _ := finding["osv"].(string)
			vulns = append(vulns, map[string]any{
				"id":      osv,
				"finding": finding,
			})
		}
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
