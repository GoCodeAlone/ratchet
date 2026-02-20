// Package config defines the Ratchet application configuration.
package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// Config is the top-level Ratchet configuration.
type Config struct {
	Server  ServerConfig  `json:"server" yaml:"server"`
	Auth    AuthConfig    `json:"auth" yaml:"auth"`
	Agents  []AgentConfig `json:"agents" yaml:"agents"`
	Plugins []string      `json:"plugins,omitempty" yaml:"plugins"` // plugin names to load
	DataDir string        `json:"data_dir" yaml:"data_dir"`
	LogLevel string       `json:"log_level" yaml:"log_level"`
}

// ServerConfig controls the HTTP server.
type ServerConfig struct {
	Addr string `json:"addr" yaml:"addr"` // listen address, e.g., ":9090"
}

// AuthConfig controls dashboard authentication.
type AuthConfig struct {
	JWTSecret string `json:"jwt_secret" yaml:"jwt_secret"`
	AdminUser string `json:"admin_user" yaml:"admin_user"`
	AdminPass string `json:"admin_pass" yaml:"admin_pass"` // bcrypt hash
}

// AgentConfig defines a single agent's configuration.
type AgentConfig struct {
	ID           string            `json:"id" yaml:"id"`
	Name         string            `json:"name" yaml:"name"`
	Role         string            `json:"role" yaml:"role"`
	SystemPrompt string            `json:"system_prompt" yaml:"system_prompt"`
	Provider     string            `json:"provider" yaml:"provider"` // "mock", "anthropic", "openai"
	Model        string            `json:"model,omitempty" yaml:"model"`
	IsLead       bool              `json:"is_lead,omitempty" yaml:"is_lead"`
	TeamID       string            `json:"team_id,omitempty" yaml:"team_id"`
	Metadata     map[string]string `json:"metadata,omitempty" yaml:"metadata"`
}

// DefaultConfig returns a config with sensible defaults.
func DefaultConfig() *Config {
	return &Config{
		Server: ServerConfig{
			Addr: ":9090",
		},
		Auth: AuthConfig{
			AdminUser: "admin",
		},
		DataDir:  "./data",
		LogLevel: "info",
		Agents: []AgentConfig{
			{
				ID:           "lead",
				Name:         "Lead",
				Role:         "orchestrator",
				SystemPrompt: "You are the lead orchestrator agent. You plan work, delegate tasks to team members, and ensure forward progress.",
				Provider:     "mock",
				IsLead:       true,
				TeamID:       "default",
			},
		},
	}
}

// Load reads a YAML config file and returns the parsed configuration.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config %s: %w", path, err)
	}
	cfg := DefaultConfig()
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config %s: %w", path, err)
	}
	return cfg, nil
}
