package ratchetplugin

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/CrisisTextLine/modular"
	"github.com/GoCodeAlone/ratchet/provider"
	"github.com/GoCodeAlone/ratchet/ratchetplugin/tools"
	"github.com/GoCodeAlone/workflow/module"
	"github.com/GoCodeAlone/workflow/plugin"
	"github.com/google/uuid"
)

// AgentExecuteStep runs the autonomous agent loop for a single task.
type AgentExecuteStep struct {
	name            string
	maxIterations   int
	providerService string
	app             modular.Application
	tmpl            *module.TemplateEngine
	toolRegistry    *ToolRegistry
	guard           *SecretGuard
	recorder        *TranscriptRecorder
	containerMgr    *ContainerManager
}

func (s *AgentExecuteStep) Name() string { return s.name }

func (s *AgentExecuteStep) Execute(ctx context.Context, pc *module.PipelineContext) (*module.StepResult, error) {
	if s.app == nil {
		return nil, fmt.Errorf("agent_execute step %q: no application context", s.name)
	}

	// Resolve provider service name
	providerSvcRaw, err := s.tmpl.Resolve(s.providerService, pc)
	if err != nil {
		return nil, fmt.Errorf("agent_execute step %q: resolve provider_service: %w", s.name, err)
	}
	providerSvcName := fmt.Sprintf("%v", providerSvcRaw)

	svc, ok := s.app.SvcRegistry()[providerSvcName]
	if !ok {
		return nil, fmt.Errorf("agent_execute step %q: provider service %q not found", s.name, providerSvcName)
	}
	providerMod, ok := svc.(*AIProviderModule)
	if !ok {
		return nil, fmt.Errorf("agent_execute step %q: service %q is not an AIProviderModule", s.name, providerSvcName)
	}
	aiProvider := providerMod.Provider()

	// Extract agent and task data
	systemPrompt := extractString(pc.Current, "system_prompt", "You are a helpful AI agent.")
	taskDescription := extractString(pc.Current, "description", extractString(pc.Current, "task", "Complete the assigned task."))
	agentName := extractString(pc.Current, "agent_name", extractString(pc.Current, "name", "agent"))
	agentID := extractString(pc.Current, "agent_id", agentName)
	taskID := extractString(pc.Current, "task_id", extractString(pc.Current, "id", ""))
	projectID := extractString(pc.Current, "project_id", "")

	// Build enriched context with workspace/container info
	toolCtx := ctx
	if projectID != "" {
		toolCtx = tools.WithProjectID(toolCtx, projectID)

		// Look up project workspace path from DB
		if s.app != nil {
			if svc, ok := s.app.SvcRegistry()["ratchet-db"]; ok {
				if dbp, ok := svc.(module.DBProvider); ok && dbp.DB() != nil {
					var wsPath string
					row := dbp.DB().QueryRowContext(ctx,
						"SELECT workspace_path FROM projects WHERE id = ?", projectID,
					)
					if row.Scan(&wsPath) == nil && wsPath != "" {
						toolCtx = tools.WithWorkspacePath(toolCtx, wsPath)
					}
				}
			}
		}

		// If container manager is available, inject it as ContainerExecer
		if s.containerMgr != nil && s.containerMgr.IsAvailable() {
			toolCtx = context.WithValue(toolCtx, tools.ContextKeyContainerID, tools.ContainerExecer(s.containerMgr))
		}
	}

	// Build initial conversation
	messages := []provider.Message{
		{Role: provider.RoleSystem, Content: systemPrompt},
		{Role: provider.RoleUser, Content: fmt.Sprintf("Task for agent %q:\n\n%s", agentName, taskDescription)},
	}

	// Get tool definitions
	var toolDefs []provider.ToolDef
	if s.toolRegistry != nil {
		toolDefs = s.toolRegistry.AllDefs()
	}

	// Record system prompt and user message
	if s.recorder != nil {
		for _, msg := range messages {
			_ = s.recorder.Record(ctx, TranscriptEntry{
				ID:        uuid.New().String(),
				AgentID:   agentID,
				TaskID:    taskID,
				ProjectID: projectID,
				Iteration: 0,
				Role:      msg.Role,
				Content:   msg.Content,
			})
		}
	}

	var finalContent string
	iterCount := 0

	for iterCount < s.maxIterations {
		iterCount++

		// Redact secrets from messages before sending to LLM
		if s.guard != nil {
			for i := range messages {
				s.guard.CheckAndRedact(&messages[i])
			}
		}

		resp, err := aiProvider.Chat(ctx, messages, toolDefs)
		if err != nil {
			return nil, fmt.Errorf("agent_execute step %q: iteration %d: %w", s.name, iterCount, err)
		}

		finalContent = resp.Content

		// Record assistant response
		if s.recorder != nil {
			_ = s.recorder.Record(ctx, TranscriptEntry{
				ID:        uuid.New().String(),
				AgentID:   agentID,
				TaskID:    taskID,
				ProjectID: projectID,
				Iteration: iterCount,
				Role:      provider.RoleAssistant,
				Content:   resp.Content,
				ToolCalls: resp.ToolCalls,
			})
		}

		// No tool calls — we have a final answer
		if len(resp.ToolCalls) == 0 {
			break
		}

		// Execute tool calls and append results
		messages = append(messages, provider.Message{
			Role:    provider.RoleAssistant,
			Content: resp.Content,
		})

		for _, tc := range resp.ToolCalls {
			var resultStr string
			if s.toolRegistry != nil {
				result, execErr := s.toolRegistry.Execute(toolCtx, tc.Name, tc.Arguments)
				if execErr != nil {
					resultStr = fmt.Sprintf("Error: %v", execErr)
				} else {
					resultBytes, _ := json.Marshal(result)
					resultStr = string(resultBytes)
				}
			} else {
				resultStr = "Tool execution not available"
			}

			// Redact tool results
			if s.guard != nil {
				resultStr = s.guard.Redact(resultStr)
			}

			messages = append(messages, provider.Message{
				Role:       provider.RoleTool,
				Content:    resultStr,
				ToolCallID: tc.ID,
			})

			// Record tool result
			if s.recorder != nil {
				_ = s.recorder.Record(ctx, TranscriptEntry{
					ID:         uuid.New().String(),
					AgentID:    agentID,
					TaskID:     taskID,
					ProjectID:  projectID,
					Iteration:  iterCount,
					Role:       provider.RoleTool,
					Content:    resultStr,
					ToolCallID: tc.ID,
				})
			}
		}
	}

	output := map[string]any{
		"result":     finalContent,
		"status":     "completed",
		"iterations": iterCount,
	}

	return &module.StepResult{Output: output}, nil
}

// extractString safely pulls a string value from a map.
func extractString(m map[string]any, key, defaultVal string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok && s != "" {
			return s
		}
	}
	return defaultVal
}

// newAgentExecuteStepFactory returns a plugin.StepFactory for "step.agent_execute".
func newAgentExecuteStepFactory() plugin.StepFactory {
	return func(name string, cfg map[string]any, app modular.Application) (any, error) {
		maxIterations := 10
		switch v := cfg["max_iterations"].(type) {
		case int:
			maxIterations = v
		case float64:
			maxIterations = int(v)
		}
		if maxIterations <= 0 {
			maxIterations = 10
		}

		providerService, _ := cfg["provider_service"].(string)
		if providerService == "" {
			providerService = "ratchet-ai"
		}

		step := &AgentExecuteStep{
			name:            name,
			maxIterations:   maxIterations,
			providerService: providerService,
			app:             app,
			tmpl:            module.NewTemplateEngine(),
		}

		// Look up ToolRegistry from service registry
		if svc, ok := app.SvcRegistry()["ratchet-tool-registry"]; ok {
			if tr, ok := svc.(*ToolRegistry); ok {
				step.toolRegistry = tr
			}
		}

		// Look up SecretGuard from service registry
		if svc, ok := app.SvcRegistry()["ratchet-secret-guard"]; ok {
			if sg, ok := svc.(*SecretGuard); ok {
				step.guard = sg
			}
		}

		// Look up TranscriptRecorder from service registry
		if svc, ok := app.SvcRegistry()["ratchet-transcript-recorder"]; ok {
			if rec, ok := svc.(*TranscriptRecorder); ok {
				step.recorder = rec
			}
		}

		// Look up ContainerManager from service registry
		if svc, ok := app.SvcRegistry()["ratchet-container-manager"]; ok {
			if cm, ok := svc.(*ContainerManager); ok {
				step.containerMgr = cm
			}
		}

		return step, nil
	}
}
