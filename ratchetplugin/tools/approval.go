package tools

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/GoCodeAlone/ratchet/provider"
	"github.com/google/uuid"
)

// RequestApprovalTool requests human approval before proceeding with a sensitive action.
type RequestApprovalTool struct {
	DB *sql.DB
}

func (t *RequestApprovalTool) Name() string { return "request_approval" }
func (t *RequestApprovalTool) Description() string {
	return "Request human approval before proceeding with a sensitive action"
}

func (t *RequestApprovalTool) Definition() provider.ToolDef {
	return provider.ToolDef{
		Name:        t.Name(),
		Description: t.Description(),
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"action":  map[string]any{"type": "string", "description": "The action requiring approval"},
				"reason":  map[string]any{"type": "string", "description": "Why this action needs approval"},
				"details": map[string]any{"type": "string", "description": "Additional details about the action"},
			},
			"required": []string{"action", "reason"},
		},
	}
}

func (t *RequestApprovalTool) Execute(ctx context.Context, args map[string]any) (any, error) {
	action, _ := args["action"].(string)
	if action == "" {
		return nil, fmt.Errorf("action is required")
	}
	reason, _ := args["reason"].(string)
	if reason == "" {
		return nil, fmt.Errorf("reason is required")
	}
	details, _ := args["details"].(string)

	agentID, _ := AgentIDFromContext(ctx)
	taskID, _ := TaskIDFromContext(ctx)

	id := uuid.New().String()

	if t.DB != nil {
		_, err := t.DB.ExecContext(ctx,
			`INSERT INTO approvals (id, agent_id, task_id, action, reason, details, status, timeout_minutes, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, 'pending', 30, datetime('now'))`,
			id, agentID, taskID, action, reason, details,
		)
		if err != nil {
			return nil, fmt.Errorf("create approval record: %w", err)
		}
	}

	return map[string]any{
		"approval_id": id,
		"status":      "pending",
		"action":      action,
		"reason":      reason,
		"message":     "Approval request submitted. Waiting for human review.",
	}, nil
}
