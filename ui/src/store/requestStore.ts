import { create } from 'zustand';
import { HumanRequest, SSEEvent } from '../types';
import { fetchPendingRequests, fetchAllRequests, resolveRequest, cancelRequest } from '../utils/api';
import { connectSSE } from '../utils/sse';

interface RequestState {
  requests: HumanRequest[];
  loading: boolean;
  error: string | null;
  showAll: boolean;
  sseConnection: EventSource | null;
  fetchRequests: () => Promise<void>;
  setShowAll: (showAll: boolean) => void;
  resolveRequest: (id: string, responseData: unknown, comment: string) => Promise<void>;
  cancelRequest: (id: string, comment: string) => Promise<void>;
  subscribeSSE: () => void;
  unsubscribeSSE: () => void;
  updateFromEvent: (event: SSEEvent) => void;
}

export const useRequestStore = create<RequestState>((set, get) => ({
  requests: [],
  loading: false,
  error: null,
  showAll: false,
  sseConnection: null,

  fetchRequests: async () => {
    set({ loading: true, error: null });
    try {
      const requests = get().showAll
        ? await fetchAllRequests()
        : await fetchPendingRequests();
      set({ requests: requests ?? [], loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch requests';
      set({ error: msg, loading: false });
    }
  },

  setShowAll: (showAll: boolean) => {
    set({ showAll });
    get().fetchRequests();
  },

  resolveRequest: async (id: string, responseData: unknown, comment: string) => {
    set({ error: null });
    try {
      await resolveRequest(id, { response_data: responseData, comment });
      await get().fetchRequests();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to resolve request';
      set({ error: msg });
    }
  },

  cancelRequest: async (id: string, comment: string) => {
    set({ error: null });
    try {
      await cancelRequest(id, { comment });
      await get().fetchRequests();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to cancel request';
      set({ error: msg });
    }
  },

  subscribeSSE: () => {
    const existing = get().sseConnection;
    if (existing) return;

    const es = connectSSE((event) => {
      get().updateFromEvent(event);
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

  updateFromEvent: (event: SSEEvent) => {
    if (
      event.type === 'human_request_created' ||
      event.type === 'human_request_resolved' ||
      event.type === 'human_request_cancelled'
    ) {
      // Refetch on any request event
      get().fetchRequests();
    }
  },
}));
