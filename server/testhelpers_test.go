package server

import (
	"context"

	"github.com/GoCodeAlone/ratchet/agent"
	"github.com/GoCodeAlone/ratchet/comms"
	"github.com/GoCodeAlone/ratchet/server/api"
	"github.com/GoCodeAlone/ratchet/task"
)

// noopAgentManager satisfies api.AgentManager for tests.
type noopAgentManager struct{}

func (n *noopAgentManager) ListAgents() []agent.Info                  { return nil }
func (n *noopAgentManager) GetAgent(_ string) (*agent.Info, bool)     { return nil, false }
func (n *noopAgentManager) CreateAgent(_ agent.Config) error          { return nil }
func (n *noopAgentManager) StartAgent(_ string) error                 { return nil }
func (n *noopAgentManager) StopAgent(_ string) error                  { return nil }
func (n *noopAgentManager) ListTeams() []api.TeamInfo                 { return nil }

// noopTaskStore satisfies task.Store for tests.
type noopTaskStore struct{}

func (n *noopTaskStore) Create(_ *task.Task) (string, error)    { return "test-id", nil }
func (n *noopTaskStore) Get(_ string) (*task.Task, error)       { return &task.Task{ID: "test-id"}, nil }
func (n *noopTaskStore) Update(_ *task.Task) error              { return nil }
func (n *noopTaskStore) List(_ task.Filter) ([]*task.Task, error) { return nil, nil }
func (n *noopTaskStore) Delete(_ string) error                  { return nil }

// noopBus satisfies comms.Bus for tests.
type noopBus struct{}

func (n *noopBus) Publish(_ context.Context, _ *comms.Message) error        { return nil }
func (n *noopBus) Subscribe(_ string, _ comms.Handler) (unsubscribe func()) { return func() {} }
func (n *noopBus) History(_ string, _ int) ([]*comms.Message, error)        { return nil, nil }
