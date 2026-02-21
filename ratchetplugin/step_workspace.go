package ratchetplugin

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/CrisisTextLine/modular"
	"github.com/GoCodeAlone/workflow/module"
	"github.com/GoCodeAlone/workflow/plugin"
)

// WorkspaceInitStep creates a project workspace directory.
type WorkspaceInitStep struct {
	name          string
	dataDir       string
	projectIDExpr string // template expression for project ID (e.g. "{{ .steps.prepare.id }}")
	app           modular.Application
	tmpl          *module.TemplateEngine
}

func (s *WorkspaceInitStep) Name() string { return s.name }

func (s *WorkspaceInitStep) Execute(ctx context.Context, pc *module.PipelineContext) (*module.StepResult, error) {
	var projectID string

	// Try template expression first (from config)
	if s.projectIDExpr != "" {
		if resolved, err := s.tmpl.Resolve(s.projectIDExpr, pc); err == nil {
			projectID = fmt.Sprintf("%v", resolved)
		}
	}

	// Fall back to pc.Current fields
	if projectID == "" {
		projectID = extractString(pc.Current, "project_id", "")
	}
	if projectID == "" {
		projectID = extractString(pc.Current, "id", "")
	}
	if projectID == "" {
		return nil, fmt.Errorf("workspace_init step %q: project_id is required", s.name)
	}

	wsPath := filepath.Join(s.dataDir, "workspaces", projectID)

	// Create standard subdirectories
	for _, sub := range []string{"src", "output", "logs"} {
		dir := filepath.Join(wsPath, sub)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("workspace_init step %q: create %s: %w", s.name, sub, err)
		}
	}

	// Update project workspace_path in DB if we have a DB provider
	if svc, ok := s.app.SvcRegistry()["ratchet-db"]; ok {
		if dbp, ok := svc.(module.DBProvider); ok && dbp.DB() != nil {
			_, _ = dbp.DB().ExecContext(ctx,
				"UPDATE projects SET workspace_path = ?, updated_at = datetime('now') WHERE id = ?",
				wsPath, projectID,
			)
		}
	}

	return &module.StepResult{
		Output: map[string]any{
			"workspace_path": wsPath,
			"project_id":     projectID,
		},
	}, nil
}

func newWorkspaceInitFactory() plugin.StepFactory {
	return func(name string, cfg map[string]any, app modular.Application) (any, error) {
		dataDir, _ := cfg["data_dir"].(string)
		if dataDir == "" {
			dataDir = "./data"
		}
		projectIDExpr, _ := cfg["project_id"].(string)
		return &WorkspaceInitStep{
			name:          name,
			dataDir:       dataDir,
			projectIDExpr: projectIDExpr,
			app:           app,
			tmpl:          module.NewTemplateEngine(),
		}, nil
	}
}
