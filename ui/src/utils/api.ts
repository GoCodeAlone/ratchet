import type { Project, TranscriptEntry, AgentInfo, Task } from '../types';

const API_BASE = '/api';

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('auth_token');
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: authHeaders(),
  });
  return handleResponse<T>(res);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(res);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  return handleResponse<T>(res);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handleResponse<T>(res);
}

// Projects
export const fetchProjects = () => apiGet<Project[]>('/projects');
export const createProject = (data: { name: string; description?: string }) => apiPost<Project>('/projects', data);
export const fetchProject = (id: string) => apiGet<Project>(`/projects/${id}`);
export const updateProject = (id: string, data: Partial<Project>) => apiPatch<Project>(`/projects/${id}`, data);
export const fetchProjectTasks = (id: string) => apiGet<Task[]>(`/projects/${id}/tasks`);
export const fetchProjectTranscripts = (id: string) => apiGet<TranscriptEntry[]>(`/projects/${id}/transcripts`);

// Agents CRUD
export const createAgent = (data: { name: string; role?: string; system_prompt?: string; team_id?: string }) => apiPost<AgentInfo>('/agents', data);
export const deleteAgent = (id: string) => apiDelete<void>(`/agents/${id}`);
export const updateAgent = (id: string, data: Partial<AgentInfo>) => apiPatch<AgentInfo>(`/agents/${id}`, data);

// Transcripts
export const fetchTranscripts = () => apiGet<TranscriptEntry[]>('/transcripts');
export const fetchAgentTranscripts = (agentId: string) => apiGet<TranscriptEntry[]>(`/agents/${agentId}/transcripts`);
