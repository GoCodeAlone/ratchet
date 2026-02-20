package tools

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"time"

	"github.com/GoCodeAlone/ratchet/provider"
)

// ShellExecTool executes a command in the project workspace.
type ShellExecTool struct {
	Workspace string
}

func (t *ShellExecTool) Name() string { return "shell_exec" }
func (t *ShellExecTool) Description() string {
	return "Execute a shell command in the project workspace"
}
func (t *ShellExecTool) Definition() provider.ToolDef {
	return provider.ToolDef{
		Name:        t.Name(),
		Description: t.Description(),
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"command": map[string]any{"type": "string", "description": "Shell command to execute"},
				"timeout": map[string]any{"type": "integer", "description": "Timeout in seconds (default: 30, max: 300)"},
			},
			"required": []string{"command"},
		},
	}
}
func (t *ShellExecTool) Execute(ctx context.Context, args map[string]any) (any, error) {
	command, _ := args["command"].(string)
	if command == "" {
		return nil, fmt.Errorf("command is required")
	}

	timeout := 30
	if v, ok := args["timeout"].(float64); ok && v > 0 {
		timeout = int(v)
	}
	if timeout > 300 {
		timeout = 300
	}

	ctx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "sh", "-c", command)
	if t.Workspace != "" {
		cmd.Dir = t.Workspace
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			return nil, fmt.Errorf("exec command: %w", err)
		}
	}

	return map[string]any{
		"stdout":    stdout.String(),
		"stderr":    stderr.String(),
		"exit_code": exitCode,
	}, nil
}
