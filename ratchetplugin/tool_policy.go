package ratchetplugin

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/CrisisTextLine/modular"
	"github.com/GoCodeAlone/workflow/module"
	"github.com/GoCodeAlone/workflow/plugin"
	"github.com/GoCodeAlone/workflow/config"
)

// PolicyScope defines the scope of a tool policy.
type PolicyScope string

const (
	PolicyScopeGlobal PolicyScope = "global"
	PolicyScopeTeam   PolicyScope = "team"
	PolicyScopeAgent  PolicyScope = "agent"
)

// PolicyAction defines the action of a tool policy.
type PolicyAction string

const (
	PolicyAllow PolicyAction = "allow"
	PolicyDeny  PolicyAction = "deny"
)

// ToolPolicy represents a policy controlling tool access.
type ToolPolicy struct {
	ID          string
	Scope       PolicyScope
	ScopeID     string // empty for global, team_id for team, agent_id for agent
	ToolPattern string // tool name or "group:fs", "group:runtime", etc.
	Action      PolicyAction
	CreatedAt   time.Time
}

// toolGroups maps group names to the tool names they contain.
var toolGroups = map[string][]string{
	"group:fs":      {"file_read", "file_write", "file_list"},
	"group:runtime": {"shell_exec"},
	"group:web":     {"web_fetch"},
	"group:git":     {"git_clone", "git_status", "git_commit", "git_push", "git_diff"},
	"group:task":    {"task_create", "task_update"},
	"group:message": {"message_send"},
}

// ToolPolicyEngine evaluates tool access policies stored in SQLite.
type ToolPolicyEngine struct {
	db *sql.DB
}

// NewToolPolicyEngine creates a new ToolPolicyEngine backed by the given DB.
func NewToolPolicyEngine(db *sql.DB) *ToolPolicyEngine {
	return &ToolPolicyEngine{db: db}
}

// InitTable creates the tool_policies table if it does not already exist.
func (tpe *ToolPolicyEngine) InitTable() error {
	_, err := tpe.db.Exec(createToolPoliciesTable)
	return err
}

// AddPolicy inserts a new policy into the database.
func (tpe *ToolPolicyEngine) AddPolicy(ctx context.Context, policy ToolPolicy) error {
	if policy.ID == "" {
		return fmt.Errorf("tool_policy: ID is required")
	}
	if policy.ToolPattern == "" {
		return fmt.Errorf("tool_policy: ToolPattern is required")
	}
	if policy.Action != PolicyAllow && policy.Action != PolicyDeny {
		return fmt.Errorf("tool_policy: invalid action %q", policy.Action)
	}
	if policy.Scope == "" {
		policy.Scope = PolicyScopeGlobal
	}

	_, err := tpe.db.ExecContext(ctx,
		`INSERT INTO tool_policies (id, scope, scope_id, tool_pattern, action) VALUES (?, ?, ?, ?, ?)`,
		policy.ID, string(policy.Scope), policy.ScopeID, policy.ToolPattern, string(policy.Action),
	)
	return err
}

// RemovePolicy deletes a policy by ID.
func (tpe *ToolPolicyEngine) RemovePolicy(ctx context.Context, id string) error {
	_, err := tpe.db.ExecContext(ctx, `DELETE FROM tool_policies WHERE id = ?`, id)
	return err
}

// ListPolicies returns all policies ordered by scope specificity.
func (tpe *ToolPolicyEngine) ListPolicies(ctx context.Context) ([]ToolPolicy, error) {
	rows, err := tpe.db.QueryContext(ctx,
		`SELECT id, scope, scope_id, tool_pattern, action, created_at FROM tool_policies ORDER BY created_at ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var policies []ToolPolicy
	for rows.Next() {
		var p ToolPolicy
		var createdAt string
		if err := rows.Scan(&p.ID, &p.Scope, &p.ScopeID, &p.ToolPattern, &p.Action, &createdAt); err != nil {
			return nil, err
		}
		p.CreatedAt, _ = time.Parse("2006-01-02 15:04:05", createdAt)
		policies = append(policies, p)
	}
	return policies, rows.Err()
}

// IsAllowed checks whether the given tool is permitted for the given agent and team.
//
// Resolution order (most specific wins for allow; deny-wins across all matching):
//  1. Expand group patterns to concrete tool names.
//  2. Collect all policies that match the tool name (global, team, agent).
//  3. If ANY matching policy denies → return false.
//  4. If no explicit policy exists → default allow.
func (tpe *ToolPolicyEngine) IsAllowed(ctx context.Context, toolName string, agentID string, teamID string) (bool, string) {
	policies, err := tpe.ListPolicies(ctx)
	if err != nil {
		// On DB error, fail open (default allow) to avoid blocking all tool calls.
		return true, "policy engine error; defaulting to allow"
	}

	var matchingPolicies []ToolPolicy
	for _, p := range policies {
		if policyMatchesTool(p.ToolPattern, toolName) {
			switch p.Scope {
			case PolicyScopeGlobal:
				matchingPolicies = append(matchingPolicies, p)
			case PolicyScopeTeam:
				if p.ScopeID == teamID {
					matchingPolicies = append(matchingPolicies, p)
				}
			case PolicyScopeAgent:
				if p.ScopeID == agentID {
					matchingPolicies = append(matchingPolicies, p)
				}
			}
		}
	}

	if len(matchingPolicies) == 0 {
		return true, "no policy; defaulting to allow"
	}

	// Deny-wins: if any matching policy denies, it is denied.
	for _, p := range matchingPolicies {
		if p.Action == PolicyDeny {
			reason := fmt.Sprintf("denied by %s policy %q", p.Scope, p.ID)
			if p.ScopeID != "" {
				reason = fmt.Sprintf("denied by %s policy %q (scope_id=%s)", p.Scope, p.ID, p.ScopeID)
			}
			return false, reason
		}
	}

	return true, "allowed by policy"
}

// policyMatchesTool returns true if the policy pattern matches the given tool name.
// It supports exact name matches and group patterns like "group:fs".
func policyMatchesTool(pattern, toolName string) bool {
	// Direct match
	if pattern == toolName {
		return true
	}

	// Wildcard
	if pattern == "*" {
		return true
	}

	// Group expansion
	if strings.HasPrefix(pattern, "group:") {
		if tools, ok := toolGroups[pattern]; ok {
			for _, t := range tools {
				if t == toolName {
					return true
				}
			}
		}
		return false
	}

	// Prefix wildcard: "mcp_*" matches "mcp_github__get_file"
	if strings.HasSuffix(pattern, "*") {
		prefix := strings.TrimSuffix(pattern, "*")
		return strings.HasPrefix(toolName, prefix)
	}

	return false
}

// toolPolicyEngineHook creates a ToolPolicyEngine and registers it in the service registry.
func toolPolicyEngineHook() plugin.WiringHook {
	return plugin.WiringHook{
		Name:     "ratchet.tool_policy_engine",
		Priority: 81,
		Hook: func(app modular.Application, _ *config.WorkflowConfig) error {
			var db *sql.DB
			if svc, ok := app.SvcRegistry()["ratchet-db"]; ok {
				if dbp, ok := svc.(module.DBProvider); ok {
					db = dbp.DB()
				}
			}
			if db == nil {
				return nil // no DB, skip
			}

			engine := NewToolPolicyEngine(db)
			_ = app.RegisterService("ratchet-tool-policy-engine", engine)
			return nil
		},
	}
}
