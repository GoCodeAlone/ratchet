// Command ratchetd is the Ratchet server daemon.
// It bootstraps a GoCodeAlone/workflow engine with the ratchet plugin and
// runs the server entirely from the YAML config file.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/CrisisTextLine/modular"
	"github.com/GoCodeAlone/ratchet/internal/version"
	"github.com/GoCodeAlone/ratchet/ratchetplugin"
	"github.com/GoCodeAlone/workflow"
	"github.com/GoCodeAlone/workflow/config"
	"github.com/GoCodeAlone/workflow/handlers"
	"github.com/GoCodeAlone/workflow/plugin"
	pluginapi "github.com/GoCodeAlone/workflow/plugins/api"
	pluginauth "github.com/GoCodeAlone/workflow/plugins/auth"
	pluginhttp "github.com/GoCodeAlone/workflow/plugins/http"
	pluginmessaging "github.com/GoCodeAlone/workflow/plugins/messaging"
	pluginobs "github.com/GoCodeAlone/workflow/plugins/observability"
	pluginpipeline "github.com/GoCodeAlone/workflow/plugins/pipelinesteps"
	pluginscheduler "github.com/GoCodeAlone/workflow/plugins/scheduler"
	pluginstorage "github.com/GoCodeAlone/workflow/plugins/storage"
	_ "modernc.org/sqlite"
)

var (
	configPath = flag.String("config", "ratchet.yaml", "path to workflow config file")
)

func main() {
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	}))

	logger.Info("starting ratchetd",
		"version", version.Version,
		"commit", version.Commit,
	)

	// Load workflow config
	cfg, err := config.LoadFromFile(*configPath)
	if err != nil {
		log.Fatalf("Failed to load config %s: %v", *configPath, err)
	}

	// Create modular application and workflow engine
	app := modular.NewStdApplication(nil, logger)
	engine := workflow.NewStdEngine(app, logger)

	// Load workflow plugins (core primitives)
	plugins := []plugin.EnginePlugin{
		pluginhttp.New(),
		pluginobs.New(),
		pluginmessaging.New(),
		pluginauth.New(),
		pluginstorage.New(),
		pluginapi.New(),
		pluginpipeline.New(),
		pluginscheduler.New(),
	}
	for _, p := range plugins {
		if err := engine.LoadPlugin(p); err != nil {
			log.Fatalf("Failed to load plugin %s: %v", p.Name(), err)
		}
	}

	// Load the ratchet plugin (custom modules, steps, wiring hooks)
	if err := engine.LoadPlugin(ratchetplugin.New()); err != nil {
		log.Fatalf("Failed to load ratchet plugin: %v", err)
	}

	// Build engine from config
	if err := engine.BuildFromConfig(cfg); err != nil {
		log.Fatalf("Failed to build engine: %v", err)
	}

	// Start engine
	ctx, cancel := context.WithCancel(context.Background())
	if err := engine.Start(ctx); err != nil {
		log.Fatalf("Failed to start engine: %v", err)
	}

	fmt.Printf("Ratchet server running on http://localhost:9090\n")
	fmt.Printf("Version: %s (%s)\n", version.Version, version.Commit)

	// Wait for shutdown signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	fmt.Println("Shutting down...")
	cancel()
	if err := engine.Stop(context.Background()); err != nil {
		logger.Error("engine stop error", "error", err)
	}
	fmt.Println("Shutdown complete")
}

// Ensure handlers package is used (PipelineWorkflowHandler type).
var _ *handlers.PipelineWorkflowHandler
