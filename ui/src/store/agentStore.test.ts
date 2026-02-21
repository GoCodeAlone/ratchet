import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAgentStore } from './agentStore';
import type { AgentInfo, SSEEvent } from '../types';

vi.mock('../utils/api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock('../utils/sse', () => ({
  connectSSE: vi.fn(),
}));

import { apiGet, apiPost } from '../utils/api';

const mockAgent: AgentInfo = {
  id: 'agent-1',
  name: 'TestAgent',
  role: 'developer',
  system_prompt: 'You are a developer',
  provider: 'mock',
  model: 'test-model',
  status: 'idle',
  current_task: '',
  started_at: '',
  team_id: 'team-1',
  is_lead: false,
};

describe('agentStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentStore.setState({
      agents: [],
      loading: false,
      error: null,
      sseConnection: null,
    });
  });

  describe('fetchAgents', () => {
    it('populates agents array on success', async () => {
      const agents = [mockAgent, { ...mockAgent, id: 'agent-2', name: 'Agent2' }];
      vi.mocked(apiGet).mockResolvedValue(agents);

      await useAgentStore.getState().fetchAgents();

      const state = useAgentStore.getState();
      expect(state.agents).toEqual(agents);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
      expect(apiGet).toHaveBeenCalledWith('/agents');
    });

    it('handles null response by setting empty array', async () => {
      vi.mocked(apiGet).mockResolvedValue(null);

      await useAgentStore.getState().fetchAgents();

      expect(useAgentStore.getState().agents).toEqual([]);
    });

    it('sets error on failure', async () => {
      vi.mocked(apiGet).mockRejectedValue(new Error('HTTP 500: server error'));

      await useAgentStore.getState().fetchAgents();

      const state = useAgentStore.getState();
      expect(state.error).toBe('HTTP 500: server error');
      expect(state.loading).toBe(false);
      expect(state.agents).toEqual([]);
    });
  });

  describe('startAgent', () => {
    it('calls POST /agents/{id}/start and refetches', async () => {
      vi.mocked(apiPost).mockResolvedValue(undefined);
      vi.mocked(apiGet).mockResolvedValue([{ ...mockAgent, status: 'active' }]);

      await useAgentStore.getState().startAgent('agent-1');

      expect(apiPost).toHaveBeenCalledWith('/agents/agent-1/start');
      expect(apiGet).toHaveBeenCalledWith('/agents');
    });

    it('sets error on failure', async () => {
      vi.mocked(apiPost).mockRejectedValue(new Error('Failed'));

      await useAgentStore.getState().startAgent('agent-1');

      expect(useAgentStore.getState().error).toBe('Failed');
    });
  });

  describe('stopAgent', () => {
    it('calls POST /agents/{id}/stop and refetches', async () => {
      vi.mocked(apiPost).mockResolvedValue(undefined);
      vi.mocked(apiGet).mockResolvedValue([{ ...mockAgent, status: 'stopped' }]);

      await useAgentStore.getState().stopAgent('agent-1');

      expect(apiPost).toHaveBeenCalledWith('/agents/agent-1/stop');
      expect(apiGet).toHaveBeenCalledWith('/agents');
    });

    it('sets error on failure', async () => {
      vi.mocked(apiPost).mockRejectedValue(new Error('Stop failed'));

      await useAgentStore.getState().stopAgent('agent-1');

      expect(useAgentStore.getState().error).toBe('Stop failed');
    });
  });

  describe('updateAgentFromEvent', () => {
    it('updates matching agent on agent_update event', () => {
      useAgentStore.setState({ agents: [mockAgent] });

      const event: SSEEvent = {
        type: 'agent_update',
        data: { id: 'agent-1', status: 'working', current_task: 'task-5' },
      };

      useAgentStore.getState().updateAgentFromEvent(event);

      const updated = useAgentStore.getState().agents[0];
      expect(updated.status).toBe('working');
      expect(updated.current_task).toBe('task-5');
      expect(updated.name).toBe('TestAgent'); // preserved
    });

    it('updates matching agent on agent_status event', () => {
      useAgentStore.setState({ agents: [mockAgent] });

      const event: SSEEvent = {
        type: 'agent_status',
        data: { id: 'agent-1', status: 'error' },
      };

      useAgentStore.getState().updateAgentFromEvent(event);

      expect(useAgentStore.getState().agents[0].status).toBe('error');
    });

    it('ignores non-agent events', () => {
      useAgentStore.setState({ agents: [mockAgent] });

      const event: SSEEvent = {
        type: 'task_update',
        data: { id: 'task-1' },
      };

      useAgentStore.getState().updateAgentFromEvent(event);

      expect(useAgentStore.getState().agents[0]).toEqual(mockAgent);
    });

    it('does not modify non-matching agents', () => {
      const agent2 = { ...mockAgent, id: 'agent-2', name: 'Other' };
      useAgentStore.setState({ agents: [mockAgent, agent2] });

      const event: SSEEvent = {
        type: 'agent_update',
        data: { id: 'agent-1', status: 'active' },
      };

      useAgentStore.getState().updateAgentFromEvent(event);

      expect(useAgentStore.getState().agents[1]).toEqual(agent2);
    });
  });
});
