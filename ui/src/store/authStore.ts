import { create } from 'zustand';
import { User } from '../types';
import { apiPost, apiGet } from '../utils/api';

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  loadUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('auth_token'),
  user: null,
  isAuthenticated: !!localStorage.getItem('auth_token'),
  error: null,

  login: async (username: string, password: string) => {
    set({ error: null });
    try {
      const res = await apiPost<{ token: string; user: User }>('/auth/login', {
        username,
        password,
      });
      localStorage.setItem('auth_token', res.token);
      set({ token: res.token, user: res.user, isAuthenticated: true, error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      set({ error: msg, isAuthenticated: false });
      throw err;
    }
  },

  logout: () => {
    localStorage.removeItem('auth_token');
    set({ token: null, user: null, isAuthenticated: false, error: null });
  },

  loadUser: async () => {
    try {
      const user = await apiGet<User>('/auth/me');
      set({ user, isAuthenticated: true });
    } catch {
      localStorage.removeItem('auth_token');
      set({ token: null, user: null, isAuthenticated: false });
    }
  },
}));
