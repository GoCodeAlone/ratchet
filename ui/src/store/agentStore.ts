import { create } from 'zustand';
import { AgentInfo, SSEEvent } from '../types';
import { apiGet, apiPost } from '../utils/api';
import { connectSSE } from '../utils/sse';

interface AgentState {
  agents: AgentInfo[];
  loading: boolean;
  error: string | null;
  sseConnection: EventSource | null;
  fetchAgents: () => Promise<void>;
  startAgent: (id: string) => Promise<void>;
  stopAgent: (id: string) => Promise<void>;
  subscribeSSE: () => void;
  unsubscribeSSE: () => void;
  updateAgentFromEvent: (event: SSEEvent) => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  loading: false,
  error: null,
  sseConnection: null,

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      const agents = await apiGet<AgentInfo[]>('/agents');
      set({ agents: agents ?? [], loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch agents';
      set({ error: msg, loading: false });
    }
  },

  startAgent: async (id: string) => {
    try {
      await apiPost(`/agents/${id}/start`);
      await get().fetchAgents();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start agent';
      set({ error: msg });
    }
  },

  stopAgent: async (id: string) => {
    try {
      await apiPost(`/agents/${id}/stop`);
      await get().fetchAgents();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to stop agent';
      set({ error: msg });
    }
  },

  subscribeSSE: () => {
    const existing = get().sseConnection;
    if (existing) return;

    const es = connectSSE((event) => {
      get().updateAgentFromEvent(event);
    });
    set({ sseConnection: es });
  },

  unsubscribeSSE: () => {
    const es = get().sseConnection;
    if (es) {
      es.close();
      set({ sseConnection: null });
    }
  },

  updateAgentFromEvent: (event: SSEEvent) => {
    if (event.type === 'agent_update' || event.type === 'agent_status') {
      const updated = event.data as AgentInfo;
      set((state) => ({
        agents: state.agents.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)),
      }));
    }
  },
}));
