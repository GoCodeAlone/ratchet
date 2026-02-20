// Command ratchetd is the Ratchet server daemon.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/GoCodeAlone/ratchet/config"
	"github.com/GoCodeAlone/ratchet/internal/version"
	"github.com/GoCodeAlone/ratchet/server"
	"github.com/GoCodeAlone/ratchet/server/api"
)

func main() {
	var (
		configPath = flag.String("config", "ratchet.yaml", "path to config file")
		addr       = flag.String("addr", "", "listen address (overrides config)")
		dataDir    = flag.String("data-dir", "", "data directory (overrides config)")
	)
	flag.Parse()

	// Load configuration
	cfg, err := config.Load(*configPath)
	if err != nil {
		// Fall back to defaults if config file not found
		if os.IsNotExist(err) {
			cfg = config.DefaultConfig()
		} else {
			fmt.Fprintf(os.Stderr, "error loading config: %v\n", err)
			os.Exit(1)
		}
	}

	// Apply flag overrides
	if *addr != "" {
		cfg.Server.Addr = *addr
	}
	if *dataDir != "" {
		cfg.DataDir = *dataDir
	}

	// Set up logger
	logLevel := slog.LevelInfo
	switch cfg.LogLevel {
	case "debug":
		logLevel = slog.LevelDebug
	case "warn":
		logLevel = slog.LevelWarn
	case "error":
		logLevel = slog.LevelError
	}
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: logLevel,
	}))

	// Ensure data directory exists
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		logger.Error("create data dir", slog.String("path", cfg.DataDir), slog.Any("err", err))
		os.Exit(1)
	}

	// Build the agent manager
	mgr := api.NewAgentManager(cfg, logger)

	// Create and configure server
	ver := version.Version
	srv := server.New(*cfg, ver, logger)
	srv.SetAgentManager(mgr)
	srv.SetTaskStore(mgr.TaskStore())
	srv.SetBus(mgr.Bus())

	// Start server in background
	errCh := make(chan error, 1)
	go func() {
		logger.Info("starting ratchet server",
			slog.String("version", ver),
			slog.String("addr", cfg.Server.Addr),
		)
		if err := srv.Start(); err != nil {
			errCh <- err
		}
	}()

	// Wait for shutdown signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errCh:
		logger.Error("server error", slog.Any("err", err))
		os.Exit(1)
	case sig := <-quit:
		logger.Info("shutting down", slog.String("signal", sig.String()))
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*1e9) // 10s
	defer cancel()
	if err := srv.Stop(ctx); err != nil {
		logger.Error("shutdown error", slog.Any("err", err))
	}
	logger.Info("server stopped")
}
