package ratchetplugin

import (
	"net/http"
	"reflect"

	"github.com/CrisisTextLine/modular"
	"github.com/GoCodeAlone/workflow/config"
	"github.com/GoCodeAlone/workflow/plugin"
)

// sseRouteRegistrationHook registers the SSE hub's HTTP handler on the router
// with high priority to ensure it takes precedence over the static file server's catch-all route.
func sseRouteRegistrationHook() plugin.WiringHook {
	return plugin.WiringHook{
		Name:     "ratchet.sse_route_registration",
		Priority: 98, // Run before static file server registration
		Hook: func(app modular.Application, cfg *config.WorkflowConfig) error {
			// Find the SSE hub instance
			var sseHub *SSEHub
			for _, svc := range app.SvcRegistry() {
				if hub, ok := svc.(*SSEHub); ok {
					sseHub = hub
					break
				}
			}
			if sseHub == nil {
				return nil // SSE hub not configured, skip
			}

			// Find the router instance by looking for an object with HandleFunc method
			var router interface{}
			for _, svc := range app.SvcRegistry() {
				// Look for service with HandleFunc or Handle method
				rv := reflect.ValueOf(svc)
				if rv.MethodByName("HandleFunc").IsValid() {
					router = svc
					break
				}
			}
			if router == nil {
				app.Logger().Warn("router not found in service registry, SSE route registration skipped")
				return nil
			}

			// Call HandleFunc using reflection
			// The router.HandleFunc method signature is likely: HandleFunc(path string, handler http.HandlerFunc, methods ...string)
			routerValue := reflect.ValueOf(router)
			handleFuncMethod := routerValue.MethodByName("HandleFunc")
			if !handleFuncMethod.IsValid() {
				app.Logger().Warn("HandleFunc method not found on router")
				return nil
			}

			// Create the handler function
			handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				sseHub.ServeHTTP(w, r)
			})

			// Call HandleFunc with the path, handler, and GET method
			args := []reflect.Value{
				reflect.ValueOf(sseHub.Path()),
				reflect.ValueOf(handler),
				reflect.ValueOf("GET"),
			}
			result := handleFuncMethod.Call(args)

			// Check for errors
			if len(result) > 0 && !result[len(result)-1].IsNil() {
				app.Logger().Error("failed to register SSE route", "error", result[len(result)-1].Interface())
				return nil
			}

			app.Logger().Info("SSE route registered", "path", sseHub.Path())
			return nil
		},
	}
}
