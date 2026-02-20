// Package api defines the REST API handlers and interfaces for the Ratchet server.
package api

import (
	"github.com/GoCodeAlone/ratchet/agent"
)

// AgentManager is the interface the API uses to control agents.
// Implemented by the main application.
type AgentManager interface {
	ListAgents() []agent.Info
	GetAgent(id string) (*agent.Info, bool)
	CreateAgent(cfg agent.Config) error
	StartAgent(id string) error
	StopAgent(id string) error
	ListTeams() []TeamInfo
}

// TeamInfo describes a group of agents working together.
type TeamInfo struct {
	ID      string       `json:"id"`
	Name    string       `json:"name"`
	LeadID  string       `json:"lead_id"`
	Members []agent.Info `json:"members"`
}
