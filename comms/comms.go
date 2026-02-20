// Package comms provides the inter-agent communication bus.
package comms

import (
	"context"
	"time"
)

// MessageType identifies the kind of inter-agent message.
type MessageType string

const (
	TypeDirect    MessageType = "direct"    // point-to-point message
	TypeBroadcast MessageType = "broadcast" // sent to all agents in a team
	TypeTaskUpdate MessageType = "task_update" // task status change notification
	TypeRequest   MessageType = "request"   // request requiring a response
	TypeResponse  MessageType = "response"  // response to a request
)

// Message is a communication unit between agents.
type Message struct {
	ID        string            `json:"id"`
	Type      MessageType       `json:"type"`
	From      string            `json:"from"`       // sender agent ID
	To        string            `json:"to"`         // recipient agent ID (empty for broadcast)
	TeamID    string            `json:"team_id"`
	Subject   string            `json:"subject"`
	Content   string            `json:"content"`
	ReplyTo   string            `json:"reply_to,omitempty"` // ID of message being replied to
	Metadata  map[string]string `json:"metadata,omitempty"`
	Timestamp time.Time         `json:"timestamp"`
}

// Handler processes incoming messages for an agent.
type Handler func(ctx context.Context, msg *Message) error

// Bus is the inter-agent communication backbone. Agents subscribe to
// receive messages and publish messages to other agents or teams.
type Bus interface {
	// Publish sends a message. For direct messages, the To field routes
	// to a specific agent. For broadcasts, all team members receive it.
	Publish(ctx context.Context, msg *Message) error

	// Subscribe registers a handler for messages addressed to the given agent ID.
	// Returns an unsubscribe function.
	Subscribe(agentID string, handler Handler) (unsubscribe func())

	// History returns recent messages for the given agent or team.
	History(agentID string, limit int) ([]*Message, error)
}
