import { apiGet, apiPost, apiPatch, apiDelete, apiPut } from '@gocodealone/workflow-ui/api';
import type { Project, TranscriptEntry, AgentInfo, Task, ProjectRepo, ContainerStatus, WorkspaceSpec, LLMProvider, ProviderTestResult, Skill } from '../types';

// Re-export base HTTP verbs for consumers
export { apiGet, apiPost, apiPatch, apiDelete, apiPut };

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
export const fetchTaskTranscripts = (taskId: string) => apiGet<TranscriptEntry[]>(`/tasks/${taskId}/transcripts`);

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

// Dynamic Model Listing
export interface ModelInfo {
  id: string;
  name: string;
  context_window: number;
}
export interface ModelListResult {
  success: boolean;
  models?: ModelInfo[];
  error?: string;
}
export const listProviderModels = (type: string, apiKey: string, baseUrl?: string) =>
  apiPost<ModelListResult>('/providers/models', { type, api_key: apiKey, base_url: baseUrl || '' });

// MCP Servers
import type { MCPServer } from '../types';
export const fetchMcpServers = () => apiGet<MCPServer[]>('/mcp-servers');
export const createMcpServer = (data: { name: string; command: string; args?: string; url?: string; transport?: string }) =>
  apiPost<MCPServer>('/mcp-servers', data);
export const updateMcpServer = (id: string, data: Partial<MCPServer>) =>
  apiPatch<MCPServer>(`/mcp-servers/${id}`, data);
export const deleteMcpServer = (id: string) => apiDelete<void>(`/mcp-servers/${id}`);
export const reloadMcpServers = () => apiPost<{ success: boolean; reloaded: number; errors?: string[] }>('/mcp-servers/reload');

// Skills
export const fetchSkills = () => apiGet<Skill[]>('/skills');
export const fetchAgentSkills = (agentId: string) => apiGet<Skill[]>(`/agents/${agentId}/skills`);
export const assignSkillToAgent = (agentId: string, skillId: string) =>
  apiPost<{ assigned: boolean }>(`/agents/${agentId}/skills`, { skill_id: skillId });
export const removeSkillFromAgent = (agentId: string, skillId: string) =>
  apiDelete<{ removed: boolean }>(`/agents/${agentId}/skills/${skillId}`);
