export type AgentStatus = 'idle' | 'active' | 'working' | 'waiting' | 'stopped' | 'error';

export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  system_prompt: string;
  provider: string;
  model: string;
  status: AgentStatus;
  current_task: string;
  started_at: string;
  team_id: string;
  is_lead: boolean | number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed' | 'canceled';
  priority: number;
  assigned_to: string;
  team_id: string;
  project_id: string;
  result: string;
  error: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  type: string;
  from: string;
  to: string;
  subject: string;
  content: string;
  timestamp: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
}

export interface SSEEvent {
  type: string;
  data: unknown;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  workspace_path: string;
  status: 'active' | 'archived' | 'completed';
  created_at: string;
  updated_at: string;
}

export interface TranscriptEntry {
  id: string;
  agent_id: string;
  task_id: string;
  project_id: string;
  iteration: number;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls: string;
  tool_call_id: string;
  redacted: number;
  created_at: string;
}

export interface MCPServer {
  id: string;
  name: string;
  transport: 'stdio' | 'sse';
  command: string;
  args: string;
  url: string;
  status: 'active' | 'inactive';
  created_at: string;
}
