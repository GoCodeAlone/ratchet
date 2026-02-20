package ratchetplugin

import (
	"github.com/CrisisTextLine/modular"
	"github.com/GoCodeAlone/workflow/config"
	"github.com/GoCodeAlone/workflow/module"
	"github.com/GoCodeAlone/workflow/plugin"
)

// authTokenHook registers a static dev token with the auth middleware.
// This allows the hardcoded token from the login endpoint to pass auth checks.
func authTokenHook() plugin.WiringHook {
	return plugin.WiringHook{
		Name:     "ratchet.auth_token",
		Priority: 90,
		Hook: func(app modular.Application, _ *config.WorkflowConfig) error {
			// Find all auth middlewares and register our dev token
			for _, svc := range app.SvcRegistry() {
				am, ok := svc.(*module.AuthMiddleware)
				if !ok {
					continue
				}
				am.AddProvider(map[string]map[string]any{
					"ratchet-dev-token-change-me-in-production": {
						"sub":  "admin",
						"role": "admin",
					},
				})
			}
			return nil
		},
	}
}
