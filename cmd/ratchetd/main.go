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

	"github.com/GoCodeAlone/ratchet/internal/version"
	"github.com/GoCodeAlone/ratchet/ratchetplugin"
	"github.com/GoCodeAlone/workflow"
	"github.com/GoCodeAlone/workflow/config"
	_ "github.com/GoCodeAlone/workflow/setup"
	"github.com/GoCodeAlone/workflow/plugins/all"
	_ "modernc.org/sqlite"
)

var configPath = flag.String("config", "ratchet.yaml", "path to workflow config file")

func main() {
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	}))

	logger.Info("starting ratchetd",
		"version", version.Version,
		"commit", version.Commit,
	)

	cfg, err := config.LoadFromFile(*configPath)
	if err != nil {
		log.Fatalf("Failed to load config %s: %v", *configPath, err)
	}

	engine, err := workflow.NewEngineBuilder().
		WithAllDefaults().
		WithLogger(logger).
		WithPlugins(all.DefaultPlugins()...).
		WithPlugin(ratchetplugin.New()).
		BuildFromConfig(cfg)
	if err != nil {
		log.Fatalf("Failed to build engine: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	if err := engine.Start(ctx); err != nil {
		log.Fatalf("Failed to start engine: %v", err)
	}

	fmt.Printf("Ratchet server running on http://localhost:9090\n")
	fmt.Printf("Version: %s (%s)\n", version.Version, version.Commit)

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
