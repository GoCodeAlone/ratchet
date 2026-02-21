import { create } from 'zustand';
import { LLMProvider, ProviderTestResult } from '../types';
import { apiGet, apiPost, apiDelete } from '../utils/api';

interface ProviderState {
  providers: LLMProvider[];
  loading: boolean;
  error: string | null;
  fetchProviders: () => Promise<void>;
  addProvider: (data: Partial<LLMProvider>) => Promise<LLMProvider>;
  removeProvider: (alias: string) => Promise<void>;
  testProvider: (alias: string) => Promise<ProviderTestResult>;
  setDefault: (alias: string) => Promise<void>;
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  loading: false,
  error: null,

  fetchProviders: async () => {
    set({ loading: true, error: null });
    try {
      const providers = await apiGet<LLMProvider[]>('/providers');
      set({ providers: providers ?? [], loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch providers';
      set({ error: msg, loading: false });
    }
  },

  addProvider: async (data: Partial<LLMProvider>) => {
    const provider = await apiPost<LLMProvider>('/providers', data);
    await get().fetchProviders();
    return provider;
  },

  removeProvider: async (alias: string) => {
    await apiDelete(`/providers/${alias}`);
    await get().fetchProviders();
  },

  testProvider: async (alias: string) => {
    return await apiPost<ProviderTestResult>(`/providers/${alias}/test`);
  },

  setDefault: async (alias: string) => {
    await apiPost(`/providers/${alias}/default`);
    await get().fetchProviders();
  },
}));
