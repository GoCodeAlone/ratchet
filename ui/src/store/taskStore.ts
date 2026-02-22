import { create } from 'zustand';
import { Task } from '../types';
import { apiGet, apiPost, apiPatch } from '../utils/api';

interface TaskFilter {
  status?: string;
  assigned_to?: string;
  search?: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  assigned_to?: string;
  project_id?: string;
  priority?: number;
}

interface TaskState {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  fetchTasks: (filter?: TaskFilter) => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<void>;
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

  createTask: async (input: CreateTaskInput) => {
    try {
      const body: Record<string, unknown> = { title: input.title };
      if (input.description) body.description = input.description;
      if (input.assigned_to) body.assigned_to = input.assigned_to;
      if (input.project_id) body.project_id = input.project_id;
      if (input.priority !== undefined) body.priority = input.priority;
      await apiPost('/tasks', body);
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
