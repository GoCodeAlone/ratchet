// Package ratchetplugin is a workflow EnginePlugin that provides
// ratchet-specific module types, pipeline steps, and wiring hooks.
package ratchetplugin

import (
	"context"
	"database/sql"
	"os"
	"strings"

	"github.com/CrisisTextLine/modular"
	"github.com/GoCodeAlone/ratchet/ratchetplugin/tools"
	"github.com/GoCodeAlone/workflow/capability"
	"github.com/GoCodeAlone/workflow/config"
	"github.com/GoCodeAlone/workflow/module"
	"github.com/GoCodeAlone/workflow/plugin"
	"github.com/GoCodeAlone/workflow/schema"
	"github.com/GoCodeAlone/workflow/secrets"
)

// RatchetPlugin implements plugin.EnginePlugin.
// It registers:
//   - Module factories: ratchet.ai_provider, ratchet.sse_hub, ratchet.mcp_client, ratchet.mcp_server
//   - Step factories: step.agent_execute, step.workspace_init
//   - Wiring hooks: ratchet.db_init, ratchet.auth_token, ratchet.secrets_guard, ratchet.tool_registry
type RatchetPlugin struct {
	plugin.BaseEnginePlugin
}

// New creates a new RatchetPlugin ready to register with the workflow engine.
func New() *RatchetPlugin {
	return &RatchetPlugin{
		BaseEnginePlugin: plugin.BaseEnginePlugin{
			BaseNativePlugin: plugin.BaseNativePlugin{
				PluginName:        "ratchet",
				PluginVersion:     "1.0.0",
				PluginDescription: "Ratchet autonomous agent orchestration",
			},
			Manifest: plugin.PluginManifest{
				Name:        "ratchet",
				Version:     "1.0.0",
				Author:      "GoCodeAlone",
				Description: "Ratchet autonomous agent orchestration plugin",
				ModuleTypes: []string{"ratchet.ai_provider", "ratchet.sse_hub", "ratchet.mcp_client", "ratchet.mcp_server"},
				StepTypes:   []string{"step.agent_execute", "step.workspace_init", "step.container_control", "step.secret_manage", "step.provider_test", "step.vault_config", "step.provider_models", "step.mcp_reload", "step.oauth_exchange", "step.approval_resolve", "step.webhook_process", "step.security_audit"},
				WiringHooks: []string{"ratchet.db_init", "ratchet.auth_token", "ratchet.secrets_guard", "ratchet.tool_registry", "ratchet.transcript_recorder", "ratchet.container_manager", "ratchet.provider_registry", "ratchet.approval_manager", "ratchet.webhook_manager", "ratchet.security_auditor"},
			},
		},
	}
}

// Capabilities returns the capability contracts for this plugin.
func (p *RatchetPlugin) Capabilities() []capability.Contract {
	return nil
}

// ModuleFactories returns the module factories registered by this plugin.
func (p *RatchetPlugin) ModuleFactories() map[string]plugin.ModuleFactory {
	return map[string]plugin.ModuleFactory{
		"ratchet.ai_provider": newAIProviderFactory(),
		"ratchet.sse_hub":     newSSEHubFactory(),
		"ratchet.scheduler":   newSchedulerFactory(),
		"ratchet.mcp_client":  newMCPClientFactory(),
		"ratchet.mcp_server":  newMCPServerFactory(),
	}
}

// StepFactories returns the pipeline step factories registered by this plugin.
func (p *RatchetPlugin) StepFactories() map[string]plugin.StepFactory {
	return map[string]plugin.StepFactory{
		"step.agent_execute":     newAgentExecuteStepFactory(),
		"step.workspace_init":    newWorkspaceInitFactory(),
		"step.container_control": newContainerControlFactory(),
		"step.secret_manage":     newSecretManageFactory(),
		"step.provider_test":     newProviderTestFactory(),
		"step.vault_config":      newVaultConfigFactory(),
		"step.provider_models":   newProviderModelsFactory(),
		"step.mcp_reload":        newMCPReloadFactory(),
		"step.oauth_exchange":    newOAuthExchangeFactory(),
		"step.approval_resolve":  newApprovalResolveFactory(),
		"step.webhook_process":   newWebhookProcessStepFactory(),
		"step.security_audit":   newSecurityAuditFactory(),
	}
}

// WiringHooks returns the post-init wiring hooks for this plugin.
func (p *RatchetPlugin) WiringHooks() []plugin.WiringHook {
	return []plugin.WiringHook{
		dbInitHook(),
		authTokenHook(),
		secretsGuardHook(),
		providerRegistryHook(),
		toolPolicyEngineHook(),
		subAgentManagerHook(),
		toolRegistryHook(),
		containerManagerHook(),
		transcriptRecorderHook(),
		skillManagerHook(),
		approvalManagerHook(),
		webhookManagerHook(),
		securityAuditorHook(),
		browserManagerHook(),
	}
}

// ModuleSchemas returns schema definitions for the UI.
func (p *RatchetPlugin) ModuleSchemas() []*schema.ModuleSchema {
	return nil
}

// secretsGuardHook creates a SecretGuard and registers it in the service registry.
// It defaults to vault-dev (managed HashiCorp Vault dev server).
// Backend selection priority:
//  1. data/vault-config.json (vault-remote or vault-dev)
//  2. Default: vault-dev
//  3. Fallback: FileProvider if vault binary is not available
//
// Also loads RATCHET_* environment variables for backward compatibility.
func secretsGuardHook() plugin.WiringHook {
	return plugin.WiringHook{
		Name:     "ratchet.secrets_guard",
		Priority: 85,
		Hook: func(app modular.Application, _ *config.WorkflowConfig) error {
			var sp secrets.Provider
			backendName := "vault-dev"

			// Check for saved vault config
			vcfg, _ := LoadVaultConfig(vaultConfigDir())

			if vcfg != nil && vcfg.Backend == "vault-remote" && vcfg.Address != "" && vcfg.Token != "" {
				// Use remote vault from saved config
				vp, err := secrets.NewVaultProvider(secrets.VaultConfig{
					Address:   vcfg.Address,
					Token:     vcfg.Token,
					MountPath: vcfg.MountPath,
					Namespace: vcfg.Namespace,
				})
				if err != nil {
					app.Logger().Warn("vault-remote config found but connection failed, falling back to vault-dev", "error", err)
				} else {
					sp = vp
					backendName = "vault-remote"
				}
			}

			// Default to vault-dev if no remote configured
			if sp == nil {
				dp, err := secrets.NewDevVaultProvider(secrets.DevVaultConfig{})
				if err != nil {
					app.Logger().Warn("vault-dev not available (vault binary not found), falling back to file provider", "error", err)
					sp = newFileProvider(app)
					backendName = "file"
				} else {
					sp = dp
					backendName = "vault-dev"
					_ = app.RegisterService("ratchet-vault-dev", dp)
				}
			}

			guard := NewSecretGuard(sp, backendName)

			ctx := context.Background()

			// Load all secrets from the provider
			_ = guard.LoadAllSecrets(ctx)

			// Register vault token for redaction if using remote vault
			if vcfg != nil && vcfg.Token != "" {
				guard.AddKnownSecret("VAULT_TOKEN", vcfg.Token)
			}

			// Backward compat: also load RATCHET_* env vars into SecretGuard
			// (These are loaded for redaction only; the env provider is not the primary store.)
			envProvider := secrets.NewEnvProvider("RATCHET_")
			for _, env := range os.Environ() {
				if strings.HasPrefix(env, "RATCHET_") {
					parts := strings.SplitN(env, "=", 2)
					name := strings.TrimPrefix(parts[0], "RATCHET_")
					if val, err := envProvider.Get(ctx, name); err == nil && val != "" {
						guard.AddKnownSecret(name, val)
					}
				}
			}

			app.Logger().Info("secrets backend initialized", "backend", backendName)

			// Register in service registry
			_ = app.RegisterService("ratchet-secret-guard", guard)
			return nil
		},
	}
}

// newFileProvider creates the default FileProvider for secrets storage.
func newFileProvider(app modular.Application) secrets.Provider {
	secretsDir := os.Getenv("RATCHET_SECRETS_DIR")
	if secretsDir == "" {
		secretsDir = "data/secrets"
	}
	if err := os.MkdirAll(secretsDir, 0700); err != nil {
		app.Logger().Warn("failed to create secrets dir", "error", err)
	}
	return secrets.NewFileProvider(secretsDir)
}

// providerRegistryHook creates a ProviderRegistry and registers it in the service registry.
func providerRegistryHook() plugin.WiringHook {
	return plugin.WiringHook{
		Name:     "ratchet.provider_registry",
		Priority: 83,
		Hook: func(app modular.Application, _ *config.WorkflowConfig) error {
			// Get DB
			var db *sql.DB
			if svc, ok := app.SvcRegistry()["ratchet-db"]; ok {
				if dbp, ok := svc.(module.DBProvider); ok {
					db = dbp.DB()
				}
			}
			if db == nil {
				return nil // no DB, skip
			}

			// Get secrets provider from SecretGuard
			var sp secrets.Provider
			if svc, ok := app.SvcRegistry()["ratchet-secret-guard"]; ok {
				if guard, ok := svc.(*SecretGuard); ok {
					sp = guard.Provider()
				}
			}

			registry := NewProviderRegistry(db, sp)
			_ = app.RegisterService("ratchet-provider-registry", registry)
			return nil
		},
	}
}

// toolRegistryHook creates a ToolRegistry with built-in tools and registers it.
func toolRegistryHook() plugin.WiringHook {
	return plugin.WiringHook{
		Name:     "ratchet.tool_registry",
		Priority: 80,
		Hook: func(app modular.Application, _ *config.WorkflowConfig) error {
			registry := NewToolRegistry()

			// Get DB for task/message tools
			var db *sql.DB
			if svc, ok := app.SvcRegistry()["ratchet-db"]; ok {
				if dbp, ok := svc.(module.DBProvider); ok {
					db = dbp.DB()
				}
			}

			// Wire policy engine if available
			if svc, ok := app.SvcRegistry()["ratchet-tool-policy-engine"]; ok {
				if pe, ok := svc.(*ToolPolicyEngine); ok {
					registry.SetPolicyEngine(pe)
				}
			}

			// Register built-in file and shell tools
			registry.Register(&tools.FileReadTool{})
			registry.Register(&tools.FileWriteTool{})
			registry.Register(&tools.FileListTool{})
			registry.Register(&tools.ShellExecTool{})
			registry.Register(&tools.WebFetchTool{})

			// Register git tools
			registry.Register(&tools.GitCloneTool{})
			registry.Register(&tools.GitStatusTool{})
			registry.Register(&tools.GitCommitTool{})
			registry.Register(&tools.GitPushTool{})
			registry.Register(&tools.GitDiffTool{})

			if db != nil {
				registry.Register(&tools.TaskCreateTool{DB: db})
				registry.Register(&tools.TaskUpdateTool{DB: db})
				registry.Register(&tools.MessageSendTool{DB: db})
				registry.Register(&tools.RequestApprovalTool{DB: db})
			}

			// Register sub-agent tools if sub-agent manager is available
			if svc, ok := app.SvcRegistry()["ratchet-sub-agent-manager"]; ok {
				if mgr, ok := svc.(tools.SubAgentSpawner); ok {
					registry.Register(&tools.AgentSpawnTool{Manager: mgr})
					registry.Register(&tools.AgentCheckTool{Manager: mgr})
					registry.Register(&tools.AgentWaitTool{Manager: mgr})
				}
			}

			// Register memory tools if memory store is available
			if svc, ok := app.SvcRegistry()["ratchet-memory-store"]; ok {
				if ms, ok := svc.(*MemoryStore); ok {
					registry.Register(&tools.MemorySearchTool{Store: ms})
					registry.Register(&tools.MemorySaveTool{Store: ms})
				}
			}

			// Register browser tools if browser manager is available
			if svc, ok := app.SvcRegistry()["ratchet-browser-manager"]; ok {
				if bm, ok := svc.(*BrowserManager); ok {
					registry.Register(&tools.BrowserNavigateTool{Manager: bm})
					registry.Register(&tools.BrowserScreenshotTool{Manager: bm})
					registry.Register(&tools.BrowserClickTool{Manager: bm})
					registry.Register(&tools.BrowserExtractTool{Manager: bm})
					registry.Register(&tools.BrowserFillTool{Manager: bm})
				}
			}

			// Register in service registry
			_ = app.RegisterService("ratchet-tool-registry", registry)
			return nil
		},
	}
}

// containerManagerHook creates a ContainerManager and registers it in the service registry.
func containerManagerHook() plugin.WiringHook {
	return plugin.WiringHook{
		Name:     "ratchet.container_manager",
		Priority: 82,
		Hook: func(app modular.Application, _ *config.WorkflowConfig) error {
			var db *sql.DB
			if svc, ok := app.SvcRegistry()["ratchet-db"]; ok {
				if dbp, ok := svc.(module.DBProvider); ok {
					db = dbp.DB()
				}
			}
			cm := NewContainerManager(db)
			_ = app.RegisterService("ratchet-container-manager", cm)
			return nil
		},
	}
}

// transcriptRecorderHook creates a TranscriptRecorder and registers it.
func transcriptRecorderHook() plugin.WiringHook {
	return plugin.WiringHook{
		Name:     "ratchet.transcript_recorder",
		Priority: 75,
		Hook: func(app modular.Application, _ *config.WorkflowConfig) error {
			// Get DB
			var db *sql.DB
			if svc, ok := app.SvcRegistry()["ratchet-db"]; ok {
				if dbp, ok := svc.(module.DBProvider); ok {
					db = dbp.DB()
				}
			}
			if db == nil {
				return nil // no DB, skip
			}

			// Get SecretGuard (optional)
			var guard *SecretGuard
			if svc, ok := app.SvcRegistry()["ratchet-secret-guard"]; ok {
				guard, _ = svc.(*SecretGuard)
			}

			recorder := NewTranscriptRecorder(db, guard)
			_ = app.RegisterService("ratchet-transcript-recorder", recorder)
			return nil
		},
	}
}

// approvalManagerHook creates an ApprovalManager and registers it in the service registry.
func approvalManagerHook() plugin.WiringHook {
	return plugin.WiringHook{
		Name:     "ratchet.approval_manager",
		Priority: 74,
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

			am := NewApprovalManager(db)

			// Wire in SSE hub if available (optional, for push notifications)
			for _, svc := range app.SvcRegistry() {
				if hub, ok := svc.(*SSEHub); ok {
					am.SetSSEHub(hub)
					break
				}
			}

			_ = app.RegisterService("ratchet-approval-manager", am)
			return nil
		},
	}
}

// webhookManagerHook creates a WebhookManager and registers it in the service registry.
func webhookManagerHook() plugin.WiringHook {
	return plugin.WiringHook{
		Name:     "ratchet.webhook_manager",
		Priority: 73,
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

			var guard *SecretGuard
			if svc, ok := app.SvcRegistry()["ratchet-secret-guard"]; ok {
				guard, _ = svc.(*SecretGuard)
			}

			wm := NewWebhookManager(db, guard)
			_ = app.RegisterService("ratchet-webhook-manager", wm)
			return nil
		},
	}
}

// subAgentManagerHook creates a SubAgentManager and registers it in the service registry.
func subAgentManagerHook() plugin.WiringHook {
	return plugin.WiringHook{
		Name:     "ratchet.sub_agent_manager",
		Priority: 79,
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
			mgr := NewSubAgentManager(db)
			_ = app.RegisterService("ratchet-sub-agent-manager", mgr)
			return nil
		},
	}
}
