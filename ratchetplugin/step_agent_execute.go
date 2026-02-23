package ratchetplugin

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/CrisisTextLine/modular"
	"github.com/GoCodeAlone/ratchet/provider"
	"github.com/GoCodeAlone/ratchet/ratchetplugin/tools"
	"github.com/GoCodeAlone/workflow/module"
	"github.com/GoCodeAlone/workflow/plugin"
	"github.com/google/uuid"
)

// approvalWaitTimeout is the maximum time to wait for human approval.
const approvalWaitTimeout = 30 * time.Minute

// AgentExecuteStep runs the autonomous agent loop for a single task.
type AgentExecuteStep struct {
	name            string
	maxIterations   int
	providerService string
	app             modular.Application
	tmpl            *module.TemplateEngine
}

func (s *AgentExecuteStep) Name() string { return s.name }

func (s *AgentExecuteStep) Execute(ctx context.Context, pc *module.PipelineContext) (*module.StepResult, error) {
	if s.app == nil {
		return nil, fmt.Errorf("agent_execute step %q: no application context", s.name)
	}

	// Resolve AI provider via multiple paths:
	// 1. Try ProviderRegistry (DB-backed providers) if available
	// 2. Fall back to AIProviderModule (YAML-configured) lookup
	var aiProvider provider.Provider

	// Extract provider alias from pipeline data (set by agent's provider column)
	// We do this after flattening below, but we peek at data here for the alias.
	peekData := pc.Current
	if row, ok := peekData["row"].(map[string]any); ok {
		for k, v := range row {
			peekData[k] = v
		}
	}
	providerAlias := extractString(peekData, "provider", "")

	// Path 1: Try ProviderRegistry
	if regSvc, ok := s.app.SvcRegistry()["ratchet-provider-registry"]; ok {
		if registry, ok := regSvc.(*ProviderRegistry); ok {
			var regErr error
			if providerAlias != "" && providerAlias != "default" {
				aiProvider, regErr = registry.GetByAlias(ctx, providerAlias)
			} else {
				aiProvider, regErr = registry.GetDefault(ctx)
			}
			if regErr != nil {
				aiProvider = nil // fall through to path 2
			}
		}
	}

	// Path 2: Fall back to AIProviderModule lookup
	if aiProvider == nil {
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
		aiProvider = providerMod.Provider()
	}

	// Lazy-lookup services from the registry. These are registered by wiring hooks
	// which run AFTER step factories, so they may not be available at factory time.
	var toolRegistry *ToolRegistry
	if svc, ok := s.app.SvcRegistry()["ratchet-tool-registry"]; ok {
		toolRegistry, _ = svc.(*ToolRegistry)
	}
	var guard *SecretGuard
	if svc, ok := s.app.SvcRegistry()["ratchet-secret-guard"]; ok {
		guard, _ = svc.(*SecretGuard)
	}
	var recorder *TranscriptRecorder
	if svc, ok := s.app.SvcRegistry()["ratchet-transcript-recorder"]; ok {
		recorder, _ = svc.(*TranscriptRecorder)
	}
	var containerMgr *ContainerManager
	if svc, ok := s.app.SvcRegistry()["ratchet-container-manager"]; ok {
		containerMgr, _ = svc.(*ContainerManager)
	}

	// Extract agent and task data from pc.Current.
	// The find-pending-task db_query step returns data under a "row" key,
	// so we also check pc.Current["row"] for nested data.
	data := pc.Current
	if row, ok := data["row"].(map[string]any); ok {
		// Merge row fields into a flat lookup map (row fields take precedence)
		flat := make(map[string]any, len(data)+len(row))
		for k, v := range data {
			flat[k] = v
		}
		for k, v := range row {
			flat[k] = v
		}
		data = flat
	}
	systemPrompt := extractString(data, "system_prompt", "You are a helpful AI agent.")
	taskDescription := extractString(data, "description", extractString(data, "task", "Complete the assigned task."))
	agentName := extractString(data, "agent_name", extractString(data, "name", "agent"))
	agentID := extractString(data, "agent_id", agentName)
	taskID := extractString(data, "task_id", extractString(data, "id", ""))
	projectID := extractString(data, "project_id", "")
	teamID := extractString(data, "team_id", "")

	// Log provider resolution for debugging
	if s.app != nil {
		if logger := s.app.Logger(); logger != nil {
			logger.Info("agent_execute: provider resolved",
				"agent", agentName,
				"provider_alias", providerAlias,
				"provider_name", aiProvider.Name(),
			)
		}
	}

	// Build enriched context with workspace/container info
	toolCtx := ctx
	// Inject agent, task, and team IDs so tools and policies can retrieve them.
	toolCtx = tools.WithAgentID(toolCtx, agentID)
	toolCtx = tools.WithTaskID(toolCtx, taskID)
	if teamID != "" {
		toolCtx = WithTeamID(toolCtx, teamID)
	}
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
		if containerMgr != nil && containerMgr.IsAvailable() {
			toolCtx = context.WithValue(toolCtx, tools.ContextKeyContainerID, tools.ContainerExecer(containerMgr))
		}
	}

	// Skill injection: augment system prompt with assigned skill content.
	if svc, ok := s.app.SvcRegistry()["ratchet-skill-manager"]; ok {
		if sm, ok := svc.(*SkillManager); ok {
			if skillPrompt, err := sm.BuildSkillPrompt(ctx, agentID); err == nil && skillPrompt != "" {
				systemPrompt = systemPrompt + "\n\n" + skillPrompt
			}
		}
	}

	// Memory injection: augment system prompt with relevant memories before building messages.
	var memoryStore *MemoryStore
	if svc, ok := s.app.SvcRegistry()["ratchet-memory-store"]; ok {
		memoryStore, _ = svc.(*MemoryStore)
	}
	if memoryStore != nil && agentID != "" {
		memories, searchErr := memoryStore.Search(ctx, agentID, taskDescription, 5)
		if searchErr == nil && len(memories) > 0 {
			var sb strings.Builder
			sb.WriteString(systemPrompt)
			sb.WriteString("\n\n## Relevant Memory\n")
			for _, m := range memories {
				sb.WriteString("- [")
				sb.WriteString(m.Category)
				sb.WriteString("] ")
				sb.WriteString(m.Content)
				sb.WriteString("\n")
			}
			systemPrompt = sb.String()
		}
	}

	// Build initial conversation
	messages := []provider.Message{
		{Role: provider.RoleSystem, Content: systemPrompt},
		{Role: provider.RoleUser, Content: fmt.Sprintf("Task for agent %q:\n\n%s", agentName, taskDescription)},
	}

	// Get tool definitions
	var toolDefs []provider.ToolDef
	if toolRegistry != nil {
		toolDefs = toolRegistry.AllDefs()
	}

	// Record system prompt and user message
	if recorder != nil {
		for _, msg := range messages {
			_ = recorder.Record(ctx, TranscriptEntry{
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
	ld := NewLoopDetector()
	cm := NewContextManager(aiProvider.Name())

	for iterCount < s.maxIterations {
		iterCount++

		// Context window management: compact if approaching model's token limit.
		if cm.NeedsCompaction(messages) {
			estimated, limit := cm.TokenUsage(messages)
			if s.app != nil {
				if logger := s.app.Logger(); logger != nil {
					logger.Info("agent_execute: compacting context",
						"agent", agentName,
						"iteration", iterCount,
						"estimated_tokens", estimated,
						"limit", limit,
						"compaction_num", cm.Compactions()+1,
					)
				}
			}
			messages = cm.Compact(ctx, messages, aiProvider)
			if recorder != nil {
				_ = recorder.Record(ctx, TranscriptEntry{
					ID:        uuid.New().String(),
					AgentID:   agentID,
					TaskID:    taskID,
					ProjectID: projectID,
					Iteration: iterCount,
					Role:      provider.RoleUser,
					Content: fmt.Sprintf(
						"[SYSTEM] Context window compacted (compaction #%d). Estimated %d tokens of %d limit.",
						cm.Compactions(), estimated, limit,
					),
				})
			}
		}

		// Redact secrets from messages before sending to LLM
		if guard != nil {
			for i := range messages {
				guard.CheckAndRedact(&messages[i])
			}
		}

		resp, err := aiProvider.Chat(ctx, messages, toolDefs)
		if err != nil {
			// Don't abort the pipeline — return a failed result so the task can be marked.
			errMsg := fmt.Sprintf("LLM call failed at iteration %d: %v", iterCount, err)
			if s.app != nil {
				if logger := s.app.Logger(); logger != nil {
					logger.Error("agent_execute: chat failed", "agent", agentName, "iteration", iterCount, "error", err)
				}
			}
			output := map[string]any{
				"result":     errMsg,
				"status":     "failed",
				"iterations": iterCount,
				"error":      errMsg,
			}
			return &module.StepResult{Output: output}, nil
		}

		finalContent = resp.Content

		// Record assistant response
		if recorder != nil {
			_ = recorder.Record(ctx, TranscriptEntry{
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
			Role:      provider.RoleAssistant,
			Content:   resp.Content,
			ToolCalls: resp.ToolCalls,
		})

		for _, tc := range resp.ToolCalls {
			var resultStr string
			var isError bool
			if toolRegistry != nil {
				result, execErr := toolRegistry.Execute(toolCtx, tc.Name, tc.Arguments)
				if execErr != nil {
					resultStr = fmt.Sprintf("Error: %v", execErr)
					isError = true
				} else {
					resultBytes, _ := json.Marshal(result)
					resultStr = string(resultBytes)
				}
			} else {
				resultStr = "Tool execution not available"
				isError = true
			}

			// Handle approval gates: if the tool was request_approval, pause and wait.
			if tc.Name == "request_approval" && !isError {
				if approvalOutput, breakLoop := s.handleApprovalWait(ctx, resultStr, agentName, iterCount); breakLoop {
					output := map[string]any{
						"result":     approvalOutput,
						"status":     "approval_timeout",
						"iterations": iterCount,
						"error":      approvalOutput,
					}
					return &module.StepResult{Output: output}, nil
				} else {
					// Continue: replace resultStr with the resolution message
					resultStr = approvalOutput
				}
			}

			// Redact tool results
			if guard != nil {
				resultStr = guard.Redact(resultStr)
			}

			messages = append(messages, provider.Message{
				Role:       provider.RoleTool,
				Content:    resultStr,
				ToolCallID: tc.ID,
			})

			// Record tool result
			if recorder != nil {
				_ = recorder.Record(ctx, TranscriptEntry{
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

			// Loop detection: record and check after each tool execution.
			ld.Record(tc.Name, tc.Arguments, resultStr, isError)
			loopStatus, loopMsg := ld.Check()
			switch loopStatus {
			case LoopStatusWarning:
				warningContent := fmt.Sprintf("[SYSTEM] Loop warning: %s. Please try a different approach.", loopMsg)
				messages = append(messages, provider.Message{
					Role:    provider.RoleUser,
					Content: warningContent,
				})
				if recorder != nil {
					_ = recorder.Record(ctx, TranscriptEntry{
						ID:        uuid.New().String(),
						AgentID:   agentID,
						TaskID:    taskID,
						ProjectID: projectID,
						Iteration: iterCount,
						Role:      provider.RoleUser,
						Content:   warningContent,
					})
				}
			case LoopStatusBreak:
				breakMsg := fmt.Sprintf("Agent loop terminated: %s", loopMsg)
				if s.app != nil {
					if logger := s.app.Logger(); logger != nil {
						logger.Warn("agent_execute: loop detected, breaking",
							"agent", agentName, "iteration", iterCount, "reason", loopMsg)
					}
				}
				if recorder != nil {
					_ = recorder.Record(ctx, TranscriptEntry{
						ID:        uuid.New().String(),
						AgentID:   agentID,
						TaskID:    taskID,
						ProjectID: projectID,
						Iteration: iterCount,
						Role:      provider.RoleUser,
						Content:   "[SYSTEM] " + breakMsg,
					})
				}
				output := map[string]any{
					"result":     breakMsg,
					"status":     "loop_detected",
					"iterations": iterCount,
					"error":      loopMsg,
				}
				return &module.StepResult{Output: output}, nil
			}
		}
	}

	// Cancel any orphaned sub-agent tasks when the parent agent completes.
	if svc, ok := s.app.SvcRegistry()["ratchet-sub-agent-manager"]; ok {
		if sam, ok := svc.(*SubAgentManager); ok {
			if cancelErr := sam.CancelChildren(ctx, agentID); cancelErr != nil {
				if s.app != nil {
					if logger := s.app.Logger(); logger != nil {
						logger.Warn("agent_execute: failed to cancel sub-agent children",
							"agent", agentName, "error", cancelErr)
					}
				}
			}
		}
	}

	// Auto-extraction: save key facts from the conversation to persistent memory.
	if memoryStore != nil && agentID != "" {
		var transcriptBuilder strings.Builder
		for _, msg := range messages {
			if msg.Role == provider.RoleAssistant && msg.Content != "" {
				transcriptBuilder.WriteString(msg.Content)
				transcriptBuilder.WriteString("\n\n")
			}
		}
		if transcriptBuilder.Len() > 0 {
			var embedder provider.Embedder
			if e, ok := provider.AsEmbedder(aiProvider); ok {
				embedder = e
			}
			if extractErr := memoryStore.ExtractAndSave(ctx, agentID, transcriptBuilder.String(), embedder); extractErr != nil {
				if s.app != nil {
					if logger := s.app.Logger(); logger != nil {
						logger.Warn("agent_execute: failed to extract and save memory",
							"agent", agentName, "error", extractErr)
					}
				}
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

// handleApprovalWait parses the request_approval tool result, finds the ApprovalManager,
// and waits for resolution. Returns (message, breakLoop):
//   - breakLoop=true means the approval timed out and the loop should stop.
//   - breakLoop=false means continue with the provided message.
func (s *AgentExecuteStep) handleApprovalWait(ctx context.Context, toolResult, agentName string, iterCount int) (string, bool) {
	// Parse the approval ID from the tool result JSON
	var parsed map[string]any
	if err := json.Unmarshal([]byte(toolResult), &parsed); err != nil {
		return toolResult, false // not parseable, just continue
	}
	approvalID, _ := parsed["approval_id"].(string)
	if approvalID == "" {
		return toolResult, false // no approval ID, just continue
	}

	// Lazy-lookup ApprovalManager
	var am *ApprovalManager
	if svc, ok := s.app.SvcRegistry()["ratchet-approval-manager"]; ok {
		am, _ = svc.(*ApprovalManager)
	}
	if am == nil {
		// No manager available — just continue without blocking
		return toolResult, false
	}

	if s.app != nil {
		if logger := s.app.Logger(); logger != nil {
			logger.Info("agent_execute: waiting for approval",
				"agent", agentName, "iteration", iterCount, "approval_id", approvalID)
		}
	}

	// Wait up to 30 minutes for resolution
	approval, err := am.WaitForResolution(ctx, approvalID, approvalWaitTimeout)
	if err != nil {
		return fmt.Sprintf("Approval wait error: %v", err), false
	}

	switch approval.Status {
	case ApprovalApproved:
		return fmt.Sprintf("Approval granted. Reviewer comment: %s. You may proceed.", approval.ReviewerComment), false
	case ApprovalRejected:
		return fmt.Sprintf("Approval rejected. Reviewer comment: %s. Please reconsider your approach.", approval.ReviewerComment), false
	case ApprovalTimeout:
		return "Approval request timed out after waiting. Action was not approved within the timeout period.", true
	default:
		return toolResult, false
	}
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

		return &AgentExecuteStep{
			name:            name,
			maxIterations:   maxIterations,
			providerService: providerService,
			app:             app,
			tmpl:            module.NewTemplateEngine(),
		}, nil
	}
}
