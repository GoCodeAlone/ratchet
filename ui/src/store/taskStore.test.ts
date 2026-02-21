import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTaskStore } from './taskStore';
import type { Task } from '../types';

vi.mock('../utils/api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
}));

import { apiGet, apiPost, apiPatch } from '../utils/api';

const mockTask: Task = {
  id: 'task-1',
  title: 'Test Task',
  description: 'A test task',
  status: 'pending',
  priority: 1,
  assigned_to: '',
  team_id: 'team-1',
  project_id: 'proj-1',
  result: '',
  error: '',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('taskStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTaskStore.setState({
      tasks: [],
      loading: false,
      error: null,
    });
  });

  describe('fetchTasks', () => {
    it('populates tasks array on success', async () => {
      const tasks = [mockTask, { ...mockTask, id: 'task-2', title: 'Second' }];
      vi.mocked(apiGet).mockResolvedValue(tasks);

      await useTaskStore.getState().fetchTasks();

      const state = useTaskStore.getState();
      expect(state.tasks).toEqual(tasks);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
      expect(apiGet).toHaveBeenCalledWith('/tasks');
    });

    it('handles null response by setting empty array', async () => {
      vi.mocked(apiGet).mockResolvedValue(null);

      await useTaskStore.getState().fetchTasks();

      expect(useTaskStore.getState().tasks).toEqual([]);
    });

    it('passes filter as query params', async () => {
      vi.mocked(apiGet).mockResolvedValue([]);

      await useTaskStore.getState().fetchTasks({ status: 'pending', assigned_to: 'agent-1' });

      const call = vi.mocked(apiGet).mock.calls[0][0];
      expect(call).toContain('status=pending');
      expect(call).toContain('assigned_to=agent-1');
    });

    it('sets error on failure', async () => {
      vi.mocked(apiGet).mockRejectedValue(new Error('HTTP 500: internal error'));

      await useTaskStore.getState().fetchTasks();

      const state = useTaskStore.getState();
      expect(state.error).toBe('HTTP 500: internal error');
      expect(state.loading).toBe(false);
    });
  });

  describe('createTask', () => {
    it('posts new task and refetches', async () => {
      vi.mocked(apiPost).mockResolvedValue({ id: 'task-new' });
      vi.mocked(apiGet).mockResolvedValue([mockTask]);

      await useTaskStore.getState().createTask('New Task', 'Description');

      expect(apiPost).toHaveBeenCalledWith('/tasks', { title: 'New Task', description: 'Description' });
      expect(apiGet).toHaveBeenCalledWith('/tasks');
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(apiPost).mockRejectedValue(new Error('HTTP 400: bad request'));

      await expect(
        useTaskStore.getState().createTask('Bad', 'Task')
      ).rejects.toThrow('HTTP 400: bad request');

      expect(useTaskStore.getState().error).toBe('HTTP 400: bad request');
    });
  });

  describe('updateTask', () => {
    it('patches task and updates local state', async () => {
      useTaskStore.setState({ tasks: [mockTask] });
      vi.mocked(apiPatch).mockResolvedValue({ ...mockTask, status: 'completed' });

      await useTaskStore.getState().updateTask('task-1', { status: 'completed' });

      expect(apiPatch).toHaveBeenCalledWith('/tasks/task-1', { status: 'completed' });
      expect(useTaskStore.getState().tasks[0].status).toBe('completed');
    });

    it('sets error and throws on failure', async () => {
      useTaskStore.setState({ tasks: [mockTask] });
      vi.mocked(apiPatch).mockRejectedValue(new Error('HTTP 404: not found'));

      await expect(
        useTaskStore.getState().updateTask('task-1', { status: 'completed' })
      ).rejects.toThrow('HTTP 404: not found');

      expect(useTaskStore.getState().error).toBe('HTTP 404: not found');
    });
  });
});
