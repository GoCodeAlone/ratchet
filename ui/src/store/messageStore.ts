import { create } from 'zustand';
import { Message, SSEEvent } from '../types';
import { apiGet } from '../utils/api';
import { connectSSE } from '../utils/sse';

interface MessageState {
  messages: Message[];
  loading: boolean;
  error: string | null;
  sseConnection: EventSource | null;
  fetchMessages: (agentId?: string, limit?: number) => Promise<void>;
  subscribeSSE: () => void;
  unsubscribeSSE: () => void;
  addMessageFromEvent: (event: SSEEvent) => void;
}

function buildQuery(agentId?: string, limit?: number): string {
  const params = new URLSearchParams();
  if (agentId) params.set('agent_id', agentId);
  if (limit) params.set('limit', String(limit));
  const q = params.toString();
  return q ? `?${q}` : '';
}

export const useMessageStore = create<MessageState>((set, get) => ({
  messages: [],
  loading: false,
  error: null,
  sseConnection: null,

  fetchMessages: async (agentId?: string, limit?: number) => {
    set({ loading: true, error: null });
    try {
      const messages = await apiGet<Message[]>(`/messages${buildQuery(agentId, limit)}`);
      set({ messages: messages ?? [], loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch messages';
      set({ error: msg, loading: false });
    }
  },

  subscribeSSE: () => {
    const existing = get().sseConnection;
    if (existing) return;

    const es = connectSSE((event) => {
      get().addMessageFromEvent(event);
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

  addMessageFromEvent: (event: SSEEvent) => {
    if (event.type === 'message' || event.type === 'agent_message') {
      const msg = event.data as Message;
      set((state) => ({
        messages: [...state.messages, msg].slice(-500), // keep last 500
      }));
    }
  },
}));
