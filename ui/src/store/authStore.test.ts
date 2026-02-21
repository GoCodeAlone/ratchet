import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/api', () => ({
  apiPost: vi.fn(),
  apiGet: vi.fn(),
}));

// Import after mocks are set up. The authStore accesses localStorage.getItem
// at module load time, but jsdom provides localStorage so it should work.
// We need to ensure the api mock is hoisted before authStore loads.
import { useAuthStore } from './authStore';
import { apiPost, apiGet } from '../utils/api';

describe('authStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Reset zustand store
    useAuthStore.setState({
      token: null,
      user: null,
      isAuthenticated: false,
      error: null,
    });
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
      vi.mocked(apiPost).mockResolvedValue({ token: 'abc-123', user: mockUser });

      await useAuthStore.getState().login('admin', 'password');

      const state = useAuthStore.getState();
      expect(state.token).toBe('abc-123');
      expect(state.user).toEqual(mockUser);
      expect(state.isAuthenticated).toBe(true);
      expect(state.error).toBeNull();
      expect(localStorage.getItem('auth_token')).toBe('abc-123');
    });

    it('sets error on failure', async () => {
      vi.mocked(apiPost).mockRejectedValue(new Error('HTTP 401: bad credentials'));

      await expect(useAuthStore.getState().login('admin', 'wrong')).rejects.toThrow();

      const state = useAuthStore.getState();
      expect(state.error).toBe('HTTP 401: bad credentials');
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('logout', () => {
    it('clears token and user', () => {
      localStorage.setItem('auth_token', 'abc-123');
      useAuthStore.setState({
        token: 'abc-123',
        user: { id: '1', username: 'admin', email: 'admin@test.com' },
        isAuthenticated: true,
      });

      useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.token).toBeNull();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(localStorage.getItem('auth_token')).toBeNull();
    });
  });

  describe('loadUser', () => {
    it('fetches user from /auth/me and sets authenticated', async () => {
      const mockUser = { id: '1', username: 'admin', email: 'admin@test.com' };
      vi.mocked(apiGet).mockResolvedValue(mockUser);

      await useAuthStore.getState().loadUser();

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.isAuthenticated).toBe(true);
      expect(apiGet).toHaveBeenCalledWith('/auth/me');
    });

    it('clears auth state on failure', async () => {
      useAuthStore.setState({ token: 'old-token', isAuthenticated: true });
      vi.mocked(apiGet).mockRejectedValue(new Error('HTTP 401: unauthorized'));

      await useAuthStore.getState().loadUser();

      const state = useAuthStore.getState();
      expect(state.token).toBeNull();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(localStorage.getItem('auth_token')).toBeNull();
    });
  });
});
