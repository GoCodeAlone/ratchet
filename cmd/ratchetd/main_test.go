// Command ratchetd is the Ratchet server daemon.
// This test verifies the in-process composer wiring (Phase 3): building the
// engine with all four plugins (DefaultPlugins + orchestrator + auth + infra)
// registers no duplicate step types and exposes the canonical auth/secret step
// names — NOT the orchestrator's removed legacy names.
package main

import (
	"slices"
	"strings"
	"testing"

	ratchetplugin "github.com/GoCodeAlone/workflow-plugin-agent/orchestrator"
	workflowpluginauth "github.com/GoCodeAlone/workflow-plugin-auth"
	workflowplugininfra "github.com/GoCodeAlone/workflow-plugin-infra"
	"github.com/GoCodeAlone/workflow"
	"github.com/GoCodeAlone/workflow/plugins/all"
)

// TestComposer_NoDuplicateStepTypes builds the engine with the same four
// plugin sources composed in main.go and asserts:
//  1. Build succeeds — engine/plugin/loader.go:215-219 rejects duplicate step
//     types (returns "step type %q already registered"); a green build proves
//     the orchestrator (agent v0.11.0) no longer contributes the auth/secret
//     step types that auth v0.4.0 + infra v1.7.0 now own.
//  2. The canonical auth/secret step names resolve (sourced from auth + infra
//     + the engine builtin).
//  3. The orchestrator's removed legacy step names are absent.
func TestComposer_NoDuplicateStepTypes(t *testing.T) {
	engine, err := workflow.NewEngineBuilder().
		WithAllDefaults().
		WithPlugins(all.DefaultPlugins()...).
		WithPlugin(ratchetplugin.New()).
		WithPlugin(workflowpluginauth.NewAuthEnginePlugin()).
		WithPlugin(workflowplugininfra.NewInfraEnginePlugin()).
		Build()
	if err != nil {
		t.Fatalf("build engine with 4 plugins: %v (duplicate step type registration suspected)", err)
	}

	registered := engine.RegisteredStepTypes()

	// 2. Canonical step names MUST be present (sourced from auth + infra + engine).
	mustResolve := []string{
		"step.auth_password_hash",      // from auth (was orchestrator step.bcrypt_hash)
		"step.auth_anthropic_exchange", // from auth (was orchestrator step.oauth_exchange)
		"step.secret_list",             // from infra
		"step.secret_delete",           // from infra
		"step.secret_vault_status",     // from infra (was orchestrator step.vault_config)
		"step.secret_vault_test",       // from infra
		"step.secret_set",              // engine builtin
	}
	for _, st := range mustResolve {
		if !slices.Contains(registered, st) {
			t.Errorf("expected step type %q to be registered; it is missing. registered=%v", st, registered)
		}
	}

	// 3. Orchestrator's REMOVED legacy auth/secret step names MUST be absent.
	//    agent v0.11.0 dropped these 7 (Phase 3 consolidation); if any appear,
	//    either the pin didn't take or a regression re-added them.
	mustNotResolve := []string{
		"step.bcrypt_hash",
		"step.oauth_exchange",
		"step.secret_manage",
		"step.vault_config",
	}
	for _, st := range mustNotResolve {
		if slices.Contains(registered, st) {
			t.Errorf("legacy step type %q must NOT be registered (orchestrator v0.11.0 removed it); found in registry. registered=%v", st, registered)
		}
	}

	// Sanity: the orchestrator still owns its 19 remaining steps (spot-check 3).
	orchestratorStillOwns := []string{
		"step.agent_execute",
		"step.approval_resolve",
		"step.webhook_process",
	}
	for _, st := range orchestratorStillOwns {
		if !slices.Contains(registered, st) {
			t.Errorf("orchestrator step %q should still be registered; missing. registered=%v", st, registered)
		}
	}

	t.Logf("composer registered %d step types: %s", len(registered), strings.Join(registered, ", "))
}
