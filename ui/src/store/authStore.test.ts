// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureApi } from '@gocodealone/workflow-ui/api';
import { createAuthStore } from '@gocodealone/workflow-ui/auth';

describe('authStore', () => {
  let useAuthStore: ReturnType<typeof createAuthStore>;

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    configureApi({ baseUrl: '/api' });
    useAuthStore = createAuthStore();
  });

  it('initial state has no user and not authenticated when no token', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.error).toBeNull();
  });

  describe('login', () => {
    it('stores token and sets isAuthenticated on success', async () => {
      const mockUser = { id: '1', username: 'admin', email: 'admin@test.com' };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ token: 'abc-123', user: mockUser }), { status: 200 }),
      );

      await useAuthStore.getState().login('admin', 'password');

      const state = useAuthStore.getState();
      expect(state.token).toBe('abc-123');
      expect(state.user).toEqual(mockUser);
      expect(state.isAuthenticated).toBe(true);
      expect(state.error).toBeNull();
      expect(localStorage.getItem('auth_token')).toBe('abc-123');
    });

    it('sets error on failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('bad credentials', { status: 401 }),
      );

      await expect(useAuthStore.getState().login('admin', 'wrong')).rejects.toThrow();

      const state = useAuthStore.getState();
      expect(state.error).toContain('401');
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('logout', () => {
    it('clears token and user', () => {
      localStorage.setItem('auth_token', 'abc-123');
      const store = createAuthStore();
      expect(store.getState().isAuthenticated).toBe(true);

      store.getState().logout();

      const state = store.getState();
      expect(state.token).toBeNull();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(localStorage.getItem('auth_token')).toBeNull();
    });
  });

  describe('loadUser', () => {
    it('fetches user from /auth/me and sets authenticated', async () => {
      localStorage.setItem('auth_token', 'tok');
      const store = createAuthStore();
      const mockUser = { id: '1', username: 'admin', email: 'admin@test.com' };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(mockUser), { status: 200 }),
      );

      await store.getState().loadUser();

      expect(store.getState().user).toEqual(mockUser);
      expect(store.getState().isAuthenticated).toBe(true);
    });

    it('clears auth state on failure', async () => {
      localStorage.setItem('auth_token', 'old-token');
      const store = createAuthStore();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('unauthorized', { status: 401 }),
      );

      await store.getState().loadUser();

      expect(store.getState().token).toBeNull();
      expect(store.getState().user).toBeNull();
      expect(store.getState().isAuthenticated).toBe(false);
    });
  });
});
