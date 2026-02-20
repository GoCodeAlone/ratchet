import { create } from 'zustand';
import { Task } from '../types';
import { apiGet, apiPost, apiPatch } from '../utils/api';

interface TaskFilter {
  status?: string;
  assigned_to?: string;
  search?: string;
}

interface TaskState {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  fetchTasks: (filter?: TaskFilter) => Promise<void>;
  createTask: (title: string, description: string) => Promise<void>;
  updateTask: (id: string, changes: Partial<Task>) => Promise<void>;
}

function buildQuery(filter?: TaskFilter): string {
  if (!filter) return '';
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.assigned_to) params.set('assigned_to', filter.assigned_to);
  if (filter.search) params.set('search', filter.search);
  const q = params.toString();
  return q ? `?${q}` : '';
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,

  fetchTasks: async (filter?: TaskFilter) => {
    set({ loading: true, error: null });
    try {
      const tasks = await apiGet<Task[]>(`/tasks${buildQuery(filter)}`);
      set({ tasks: tasks ?? [], loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch tasks';
      set({ error: msg, loading: false });
    }
  },

  createTask: async (title: string, description: string) => {
    try {
      await apiPost('/tasks', { title, description });
      await get().fetchTasks();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create task';
      set({ error: msg });
      throw err;
    }
  },

  updateTask: async (id: string, changes: Partial<Task>) => {
    try {
      await apiPatch(`/tasks/${id}`, changes);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...changes } : t)),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update task';
      set({ error: msg });
      throw err;
    }
  },
}));
