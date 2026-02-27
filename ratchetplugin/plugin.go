// Package ratchetplugin is a workflow EnginePlugin that provides
// ratchet-specific module types, pipeline steps, and wiring hooks.
package ratchetplugin

import (
	"context"
	"database/sql"
	"os"
	"strings"

	"github.com/CrisisTextLine/modular"
	"github.com/GoCodeAlone/ratchet/provider"
	"github.com/GoCodeAlone/ratchet/ratchetplugin/tools"
	"github.com/GoCodeAlone/workflow/capability"
	"github.com/GoCodeAlone/workflow/config"
	"github.com/GoCodeAlone/workflow/module"
	"github.com/GoCodeAlone/workflow/plugin"
	"github.com/GoCodeAlone/workflow/schema"
	"github.com/GoCodeAlone/workflow/secrets"
)

// RatchetPlugin implements plugin.EnginePlugin.
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
				ModuleTypes: []string{"ratchet.ai_provider", "ratchet.sse_hub", "ratchet.scheduler", "ratchet.mcp_client", "ratchet.mcp_server"},
				StepTypes:   []string{"step.agent_execute", "step.workspace_init", "step.container_control", "step.secret_manage", "step.provider_test", "step.vault_config", "step.provider_models", "step.mcp_reload", "step.oauth_exchange", "step.approval_resolve", "step.webhook_process", "step.security_audit", "step.test_interact", "step.human_request_resolve"},
				WiringHooks: []string{"ratchet.sse_route_registration", "ratchet.db_init", "ratchet.auth_token", "ratchet.secrets_guard", "ratchet.provider_registry", "ratchet.tool_policy_engine", "ratchet.sub_agent_manager", "ratchet.tool_registry", "ratchet.container_manager", "ratchet.transcript_recorder", "ratchet.skill_manager", "ratchet.approval_manager", "ratchet.human_request_manager", "ratchet.webhook_manager", "ratchet.security_auditor", "ratchet.browser_manager", "ratchet.test_interaction"},
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
		"step.agent_execute":         newAgentExecuteStepFactory(),
		"step.workspace_init":        newWorkspaceInitFactory(),
		"step.container_control":     newContainerControlFactory(),
		"step.secret_manage":         newSecretManageFactory(),
		"step.provider_test":         newProviderTestFactory(),
		"step.vault_config":          newVaultConfigFactory(),
		"step.provider_models":       newProviderModelsFactory(),
		"step.mcp_reload":            newMCPReloadFactory(),
		"step.oauth_exchange":        newOAuthExchangeFactory(),
		"step.approval_resolve":      newApprovalResolveFactory(),
		"step.webhook_process":       newWebhookProcessStepFactory(),
		"step.security_audit":        newSecurityAuditFactory(),
		"step.test_interact":         newTestInteractFactory(),
		"step.human_request_resolve": newHumanRequestResolveFactory(),
	}
}

// WiringHooks returns the post-init wiring hooks for this plugin.
func (p *RatchetPlugin) WiringHooks() []plugin.WiringHook {
	return []plugin.WiringHook{
		sseRouteRegistrationHook(),
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
		humanRequestManagerHook(),
		webhookManagerHook(),
		securityAuditorHook(),
		browserManagerHook(),
		testInteractionHook(),
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
			}

			// Register approval tool with ApprovalManager (for SSE notifications)
			if svc, ok := app.SvcRegistry()["ratchet-approval-manager"]; ok {
				if am, ok := svc.(*ApprovalManager); ok {
					registry.Register(&tools.RequestApprovalTool{Manager: am})
				}
			}

			// Register human request tools if manager is available
			if svc, ok := app.SvcRegistry()["ratchet-human-request-manager"]; ok {
				if hrm, ok := svc.(*HumanRequestManager); ok {
					registry.Register(&tools.RequestHumanTool{Manager: hrm})
					registry.Register(&tools.CheckHumanRequestTool{Manager: hrm})
				}
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

// humanRequestManagerHook creates a HumanRequestManager and registers it in the service registry.
func humanRequestManagerHook() plugin.WiringHook {
	return plugin.WiringHook{
		Name:     "ratchet.human_request_manager",
		Priority: 81,
		Hook: func(app modular.Application, _ *config.WorkflowConfig) error {
			var db *sql.DB
			if svc, ok := app.SvcRegistry()["ratchet-db"]; ok {
				if dbp, ok := svc.(module.DBProvider); ok {
					db = dbp.DB()
				}
			}
			if db == nil {
				return nil
			}
			hrm := NewHumanRequestManager(db)
			for _, svc := range app.SvcRegistry() {
				if hub, ok := svc.(*SSEHub); ok {
					hrm.SetSSEHub(hub)
					break
				}
			}
			_ = app.RegisterService("ratchet-human-request-manager", hrm)
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
			mgr := NewSubAgentManager(db, 0, 0)
			_ = app.RegisterService("ratchet-sub-agent-manager", mgr)
			return nil
		},
	}
}

// testInteractionHook wires the HTTPSource from a test provider into the
// service registry and connects it to the SSE hub for push notifications.
// This runs at low priority so all other services are already available.
func testInteractionHook() plugin.WiringHook {
	return plugin.WiringHook{
		Name:     "ratchet.test_interaction",
		Priority: 50,
		Hook: func(app modular.Application, cfg *config.WorkflowConfig) error {
			// Find AIProviderModule instances and check for HTTPSource
			if cfg == nil {
				return nil
			}
			for _, modCfg := range cfg.Modules {
				if modCfg.Type != "ratchet.ai_provider" {
					continue
				}
				svc, ok := app.SvcRegistry()[modCfg.Name]
				if !ok {
					continue
				}
				providerMod, ok := svc.(*AIProviderModule)
				if !ok {
					continue
				}
				httpSource := providerMod.TestHTTPSource()
				if httpSource == nil {
					continue
				}
				// Wire SSE hub
				for _, svc := range app.SvcRegistry() {
					if hub, ok := svc.(*SSEHub); ok {
						httpSource.SetSSEHub(hub)
						break
					}
				}
				// Register HTTPSource so step.test_interact can find it
				_ = app.RegisterService("ratchet-test-http-source", httpSource)

				// Override the default provider in the ProviderRegistry so that
				// step.agent_execute uses the test provider instead of the seeded
				// mock provider from the llm_providers table.
				testProvider := providerMod.Provider()
				if regSvc, ok := app.SvcRegistry()["ratchet-provider-registry"]; ok {
					if registry, ok := regSvc.(*ProviderRegistry); ok {
						// Register a "test" factory that returns our pre-built test provider
						registry.factories["test"] = func(_ string, _ LLMProviderConfig) (provider.Provider, error) {
							return testProvider, nil
						}
						// Update the default provider row in the DB from "mock" to "test"
						if registry.db != nil {
							_, _ = registry.db.Exec(`UPDATE llm_providers SET type = 'test', alias = 'test' WHERE id = 'mock-default'`)
							registry.InvalidateCache()
						}
						app.Logger().Info("test interaction hook: registered test provider factory and updated default provider")
					}
				}

				app.Logger().Info("test interaction hook: registered HTTPSource for test provider")
			}
			return nil
		},
	}
}
