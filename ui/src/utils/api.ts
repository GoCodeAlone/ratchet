import type { Project, TranscriptEntry, AgentInfo, Task, ProjectRepo, ContainerStatus, WorkspaceSpec, LLMProvider, ProviderTestResult } from '../types';

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

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(res);
}

// Projects
export const fetchProjects = () => apiGet<Project[]>('/projects');
export const createProject = (data: { name: string; description?: string; workspace_spec?: WorkspaceSpec }) => apiPost<Project>('/projects', data);
export const fetchProject = (id: string) => apiGet<Project>(`/projects/${id}`);
export const updateProject = (id: string, data: Partial<Project>) => apiPatch<Project>(`/projects/${id}`, data);
export const fetchProjectTasks = (id: string) => apiGet<Task[]>(`/projects/${id}/tasks`);
export const fetchProjectTranscripts = (id: string) => apiGet<TranscriptEntry[]>(`/projects/${id}/transcripts`);

// Agents CRUD
export const createAgent = (data: { name: string; role?: string; system_prompt?: string; team_id?: string; provider?: string; model?: string }) => apiPost<AgentInfo>('/agents', data);
export const deleteAgent = (id: string) => apiDelete<void>(`/agents/${id}`);
export const updateAgent = (id: string, data: Partial<AgentInfo>) => apiPatch<AgentInfo>(`/agents/${id}`, data);

// Project Repos
export const fetchProjectRepos = (projectId: string) => apiGet<ProjectRepo[]>(`/projects/${projectId}/repos`);
export const addProjectRepo = (projectId: string, data: { repo_url: string; branch?: string }) => apiPost<ProjectRepo>(`/projects/${projectId}/repos`, data);
export const removeProjectRepo = (projectId: string, repoId: string) => apiDelete<void>(`/projects/${projectId}/repos/${repoId}`);

// Container Control
export const startContainer = (projectId: string) => apiPost<ContainerStatus>(`/projects/${projectId}/container/start`);
export const stopContainer = (projectId: string) => apiPost<ContainerStatus>(`/projects/${projectId}/container/stop`);
export const getContainerStatus = (projectId: string) => apiGet<ContainerStatus>(`/projects/${projectId}/container/status`);

// Transcripts
export const fetchTranscripts = () => apiGet<TranscriptEntry[]>('/transcripts');
export const fetchAgentTranscripts = (agentId: string) => apiGet<TranscriptEntry[]>(`/agents/${agentId}/transcripts`);

// Providers
export const fetchProviders = () => apiGet<LLMProvider[]>('/providers');
export const createProvider = (data: Partial<LLMProvider>) => apiPost<LLMProvider>('/providers', data);
export const fetchProvider = (alias: string) => apiGet<LLMProvider>(`/providers/${alias}`);
export const updateProvider = (alias: string, data: Partial<LLMProvider>) => apiPatch<LLMProvider>(`/providers/${alias}`, data);
export const deleteProvider = (alias: string) => apiDelete<void>(`/providers/${alias}`);
export const testProvider = (alias: string) => apiPost<ProviderTestResult>(`/providers/${alias}/test`);
export const setDefaultProvider = (alias: string) => apiPost<void>(`/providers/${alias}/default`);

// Secrets
export const listSecrets = () => apiGet<string[]>('/secrets');
export const storeSecret = (key: string, value: string) => apiPut<void>(`/secrets/${key}`, { value });
export const deleteSecret = (key: string) => apiDelete<void>(`/secrets/${key}`);

// Vault Config
export interface VaultStatus {
  backend: string;
  address: string;
  mount_path: string;
  namespace: string;
}
export interface VaultTestRequest {
  address: string;
  token: string;
  mount_path?: string;
  namespace?: string;
}
export interface VaultConfigureRequest extends VaultTestRequest {
  migrate_secrets?: string;
}
export interface VaultResult {
  success: boolean;
  message?: string;
  error?: string;
  backend?: string;
  migrated?: number;
}
export const fetchVaultStatus = () => apiGet<VaultStatus>('/vault/status');
export const testVaultConnection = (req: VaultTestRequest) => apiPost<VaultResult>('/vault/test', req);
export const configureVault = (req: VaultConfigureRequest) => apiPost<VaultResult>('/vault/configure', req);
export const migrateVaultSecrets = () => apiPost<VaultResult>('/vault/migrate', {});
export const resetVault = () => apiPost<VaultResult>('/vault/reset', {});
