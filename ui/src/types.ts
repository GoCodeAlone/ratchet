export type AgentStatus = 'idle' | 'working' | 'waiting' | 'stopped' | 'error';

export interface AgentInfo {
  id: string;
  name: string;
  personality: {
    name: string;
    role: string;
    system_prompt: string;
    model: string;
  };
  status: AgentStatus;
  current_task: string;
  started_at: string;
  team_id: string;
  is_lead: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed' | 'canceled';
  priority: number;
  assigned_to: string;
  team_id: string;
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
