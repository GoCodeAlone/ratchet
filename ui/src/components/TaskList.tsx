import { useEffect, useState, FormEvent } from 'react';
import { useTaskStore, CreateTaskInput } from '../store/taskStore';
import { useAgentStore } from '../store/agentStore';
import { colors, statusColors, baseStyles } from '../theme';
import { Task, Project, TranscriptEntry } from '../types';
import { fetchProjects, fetchTaskTranscripts } from '../utils/api';

type TaskStatus = Task['status'];

const ALL_STATUSES: TaskStatus[] = [
  'pending',
  'assigned',
  'in_progress',
  'completed',
  'failed',
  'canceled',
];

function StatusBadge({ status }: { status: TaskStatus }) {
  const color = statusColors[status] ?? colors.overlay0;
  return (
    <span
      style={{
        fontSize: '12px',
        color,
        backgroundColor: `${color}22`,
        padding: '2px 10px',
        borderRadius: '10px',
        textTransform: 'capitalize',
        whiteSpace: 'nowrap',
      }}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

interface ToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
  name?: string;
  input?: unknown;
}

function TranscriptMessage({ entry }: { entry: TranscriptEntry }) {
  const [collapsed, setCollapsed] = useState(entry.role === 'system');

  const roleColors: Record<string, string> = {
    system: colors.overlay0,
    user: colors.blue,
    assistant: colors.green,
    tool: colors.yellow,
  };

  const borderColor = roleColors[entry.role] ?? colors.overlay0;

  let toolCalls: ToolCall[] = [];
  if (entry.tool_calls) {
    try {
      const parsed = JSON.parse(entry.tool_calls);
      toolCalls = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // ignore parse errors
    }
  }

  if (entry.role === 'system') {
    return (
      <div
        style={{
          backgroundColor: colors.mantle,
          borderRadius: '6px',
          marginBottom: '8px',
          overflow: 'hidden',
        }}
      >
        <div
          onClick={() => setCollapsed((c) => !c)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 10px',
            cursor: 'pointer',
            color: colors.overlay0,
            fontSize: '12px',
          }}
        >
          <span style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            System
          </span>
          <span style={{ flex: 1, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {collapsed ? (entry.content?.slice(0, 80) ?? '') + (entry.content?.length > 80 ? '…' : '') : ''}
          </span>
          <span>{collapsed ? '▶' : '▼'}</span>
        </div>
        {!collapsed && (
          <div
            style={{
              padding: '0 10px 10px',
              color: colors.overlay0,
              fontSize: '12px',
              fontStyle: 'italic',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {entry.content}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        borderLeft: `3px solid ${borderColor}`,
        paddingLeft: '12px',
        marginBottom: '12px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '4px',
        }}
      >
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: borderColor,
          }}
        >
          {entry.role}
        </span>
        {entry.tool_call_id && (
          <span style={{ fontSize: '11px', color: colors.overlay0, fontFamily: 'monospace' }}>
            id: {entry.tool_call_id}
          </span>
        )}
        <span style={{ fontSize: '11px', color: colors.overlay0, marginLeft: 'auto' }}>
          {entry.created_at ? new Date(entry.created_at).toLocaleTimeString() : ''}
        </span>
      </div>

      {entry.content && (
        <div
          style={{
            color: entry.role === 'tool' ? colors.text : colors.subtext1,
            fontSize: '13px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: entry.role === 'tool' ? 'monospace' : 'inherit',
            backgroundColor: entry.role === 'tool' ? colors.mantle : 'transparent',
            padding: entry.role === 'tool' ? '8px' : '0',
            borderRadius: entry.role === 'tool' ? '4px' : '0',
          }}
        >
          {entry.content}
        </div>
      )}

      {toolCalls.length > 0 && (
        <div style={{ marginTop: '8px' }}>
          {toolCalls.map((tc, i) => {
            const name = tc.function?.name ?? tc.name ?? 'unknown';
            const rawArgs = tc.function?.arguments ?? (tc.input ? JSON.stringify(tc.input, null, 2) : '');
            let prettyArgs = rawArgs;
            if (rawArgs) {
              try {
                prettyArgs = JSON.stringify(JSON.parse(rawArgs as string), null, 2);
              } catch {
                prettyArgs = rawArgs as string;
              }
            }
            return (
              <div
                key={i}
                style={{
                  backgroundColor: `${colors.yellow}11`,
                  border: `1px solid ${colors.yellow}33`,
                  borderRadius: '4px',
                  padding: '8px',
                  marginBottom: '4px',
                  fontSize: '12px',
                }}
              >
                <div style={{ color: colors.yellow, fontWeight: 600, marginBottom: '4px' }}>
                  Tool call: {name}
                </div>
                {prettyArgs && (
                  <pre
                    style={{
                      margin: 0,
                      color: colors.subtext1,
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {prettyArgs}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskDetail({ task, onClose }: { task: Task; onClose: () => void }) {
  const { agents } = useAgentStore();
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [loadingTranscripts, setLoadingTranscripts] = useState(false);
  const [showSystem, setShowSystem] = useState(false);

  useEffect(() => {
    setLoadingTranscripts(true);
    fetchTaskTranscripts(task.id)
      .then((data: TranscriptEntry[]) => setTranscripts(data ?? []))
      .catch(() => setTranscripts([]))
      .finally(() => setLoadingTranscripts(false));
  }, [task.id]);

  // Auto-refresh for in-progress tasks
  useEffect(() => {
    if (task.status !== 'in_progress') return;
    const interval = setInterval(() => {
      fetchTaskTranscripts(task.id)
        .then((data: TranscriptEntry[]) => setTranscripts(data ?? []))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [task.id, task.status]);

  const assignedAgent = agents.find((a) => a.id === task.assigned_to);
  const statusColor = statusColors[task.status] ?? colors.overlay0;

  const visibleTranscripts = showSystem
    ? transcripts
    : transcripts.filter((t) => t.role !== 'system');

  const systemCount = transcripts.filter((t) => t.role === 'system').length;

  return (
    <div
      style={{
        ...baseStyles.card,
        marginBottom: '16px',
        borderLeft: `3px solid ${statusColor}`,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
            <h3 style={{ margin: 0, color: colors.text, fontSize: '15px' }}>{task.title}</h3>
            <StatusBadge status={task.status} />
            {task.priority > 7 ? (
              <span style={{ fontSize: '12px', color: colors.red }}>High priority ({task.priority})</span>
            ) : task.priority > 4 ? (
              <span style={{ fontSize: '12px', color: colors.yellow }}>Med priority ({task.priority})</span>
            ) : (
              <span style={{ fontSize: '12px', color: colors.overlay0 }}>Low priority ({task.priority})</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            {assignedAgent && (
              <span style={{ fontSize: '12px', color: colors.subtext0 }}>
                Agent: <span style={{ color: colors.mauve }}>{assignedAgent.name}</span>
              </span>
            )}
            {!assignedAgent && task.assigned_to && (
              <span style={{ fontSize: '12px', color: colors.subtext0 }}>
                Agent: <span style={{ color: colors.overlay0, fontFamily: 'monospace' }}>{task.assigned_to}</span>
              </span>
            )}
            {task.created_at && (
              <span style={{ fontSize: '12px', color: colors.overlay0 }}>
                Created: {new Date(task.created_at).toLocaleString()}
              </span>
            )}
            {task.updated_at && (
              <span style={{ fontSize: '12px', color: colors.overlay0 }}>
                Updated: {new Date(task.updated_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: colors.overlay0, cursor: 'pointer', fontSize: '18px', padding: '0 0 0 12px', flexShrink: 0 }}
        >
          &times;
        </button>
      </div>

      {/* Description */}
      {task.description && (
        <p style={{ color: colors.subtext0, fontSize: '13px', margin: '0 0 12px', lineHeight: '1.5' }}>
          {task.description}
        </p>
      )}

      {/* Result */}
      {task.result && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ color: colors.green, fontSize: '12px', fontWeight: 600, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Result
          </div>
          <pre
            style={{
              margin: 0,
              padding: '10px',
              backgroundColor: colors.mantle,
              borderRadius: '6px',
              fontSize: '13px',
              color: colors.text,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {task.result}
          </pre>
        </div>
      )}

      {/* Error */}
      {task.error && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ color: colors.red, fontSize: '12px', fontWeight: 600, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Error
          </div>
          <pre
            style={{
              margin: 0,
              padding: '10px',
              backgroundColor: `${colors.red}11`,
              borderRadius: '6px',
              fontSize: '13px',
              color: colors.red,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {task.error}
          </pre>
        </div>
      )}

      {/* Transcript section */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '10px',
            paddingTop: '12px',
            borderTop: `1px solid ${colors.surface1}`,
          }}
        >
          <span style={{ color: colors.subtext1, fontSize: '13px', fontWeight: 600 }}>
            Execution Transcript
          </span>
          {loadingTranscripts && (
            <span style={{ fontSize: '12px', color: colors.overlay0 }}>Loading…</span>
          )}
          {task.status === 'in_progress' && !loadingTranscripts && (
            <span style={{ fontSize: '12px', color: colors.yellow }}>Live (refreshing every 5s)</span>
          )}
          {transcripts.length > 0 && (
            <span style={{ fontSize: '12px', color: colors.overlay0 }}>
              {transcripts.length} message{transcripts.length !== 1 ? 's' : ''}
            </span>
          )}
          {systemCount > 0 && (
            <button
              onClick={() => setShowSystem((s) => !s)}
              style={{
                background: 'none',
                border: `1px solid ${colors.surface1}`,
                borderRadius: '4px',
                color: colors.overlay0,
                cursor: 'pointer',
                fontSize: '11px',
                padding: '2px 8px',
              }}
            >
              {showSystem ? 'Hide system' : `Show system (${systemCount})`}
            </button>
          )}
        </div>

        {!loadingTranscripts && transcripts.length === 0 && (
          <div style={{ color: colors.overlay0, fontSize: '13px', fontStyle: 'italic', padding: '8px 0' }}>
            No transcript entries yet.
          </div>
        )}

        {visibleTranscripts.map((entry) => (
          <TranscriptMessage key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function NewTaskModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (input: CreateTaskInput) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [projectId, setProjectId] = useState('');
  const [priority, setPriority] = useState(1);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { agents, fetchAgents } = useAgentStore();

  useEffect(() => {
    fetchAgents();
    fetchProjects()
      .then((data: Project[]) => setProjects(data ?? []))
      .catch(() => {});
  }, [fetchAgents]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    setError('');
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        assigned_to: assignedTo || undefined,
        project_id: projectId || undefined,
        priority,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setLoading(false);
    }
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    color: colors.subtext1,
    fontSize: '13px',
    marginBottom: '6px',
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          ...baseStyles.card,
          width: '500px',
          padding: '28px',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <h3 style={{ margin: '0 0 20px', color: colors.text, fontSize: '16px' }}>New Task</h3>

        {error && (
          <div
            style={{
              color: colors.red,
              fontSize: '13px',
              marginBottom: '12px',
              padding: '8px 12px',
              backgroundColor: `${colors.red}11`,
              borderRadius: '6px',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              required
              autoFocus
              style={baseStyles.input}
            />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional task description"
              rows={3}
              style={{
                ...baseStyles.input,
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
            <div>
              <label style={labelStyle}>Assign To</label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                style={{ ...baseStyles.input, cursor: 'pointer' }}
              >
                <option value="">(Unassigned)</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Priority</label>
              <input
                type="number"
                min={1}
                max={10}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                style={baseStyles.input}
              />
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={labelStyle}>Project</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              style={{ ...baseStyles.input, cursor: 'pointer' }}
            >
              <option value="">(No project)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={baseStyles.button.secondary}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim()}
              style={{
                ...baseStyles.button.primary,
                opacity: loading || !title.trim() ? 0.6 : 1,
              }}
            >
              {loading ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function TaskList() {
  const { tasks, loading, fetchTasks, createTask } = useTaskStore();
  const { agents, fetchAgents } = useAgentStore();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [agentFilter, setAgentFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState<Task | null>(null);

  useEffect(() => {
    fetchAgents();
    fetchTasks();
  }, [fetchAgents, fetchTasks]);

  function applyFilters() {
    fetchTasks({
      status: statusFilter || undefined,
      assigned_to: agentFilter || undefined,
      search: search || undefined,
    });
  }

  const filteredTasks = tasks.filter((t) => {
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter && t.status !== statusFilter) return false;
    if (agentFilter && t.assigned_to !== agentFilter) return false;
    return true;
  });

  return (
    <div style={{ maxWidth: '1100px' }}>
      {/* Filters */}
      <div
        style={{
          display: 'flex',
          gap: '10px',
          marginBottom: '16px',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tasks..."
          style={{ ...baseStyles.input, width: '200px' }}
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            ...baseStyles.input,
            width: '160px',
          }}
        >
          <option value="">All statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>

        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          style={{
            ...baseStyles.input,
            width: '160px',
          }}
        >
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <button onClick={applyFilters} style={{ ...baseStyles.button.secondary, fontSize: '13px', padding: '8px 14px' }}>
          Apply
        </button>

        <div style={{ flex: 1 }} />

        <button onClick={() => setShowModal(true)} style={{ ...baseStyles.button.primary, fontSize: '13px' }}>
          + New Task
        </button>
      </div>

      {/* Task detail */}
      {selected && (
        <TaskDetail
          task={selected}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Table */}
      {loading && filteredTasks.length === 0 ? (
        <div style={{ color: colors.subtext0, textAlign: 'center', padding: '40px' }}>
          Loading tasks...
        </div>
      ) : filteredTasks.length === 0 ? (
        <div
          style={{
            ...baseStyles.card,
            textAlign: 'center',
            padding: '60px',
            color: colors.overlay0,
          }}
        >
          No tasks found.
        </div>
      ) : (
        <div style={{ ...baseStyles.card, padding: 0, overflow: 'hidden' }}>
          <table style={baseStyles.table}>
            <thead>
              <tr style={{ backgroundColor: colors.mantle }}>
                <th style={baseStyles.th}>Title</th>
                <th style={baseStyles.th}>Status</th>
                <th style={baseStyles.th}>Priority</th>
                <th style={baseStyles.th}>Assigned To</th>
                <th style={baseStyles.th}>Project</th>
                <th style={baseStyles.th}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((task) => (
                <tr
                  key={task.id}
                  onClick={() => setSelected(selected?.id === task.id ? null : task)}
                  style={{
                    cursor: 'pointer',
                    backgroundColor:
                      selected?.id === task.id ? `${colors.blue}11` : 'transparent',
                  }}
                >
                  <td style={{ ...baseStyles.td, fontWeight: '500' }}>{task.title}</td>
                  <td style={baseStyles.td}>
                    <StatusBadge status={task.status} />
                  </td>
                  <td style={{ ...baseStyles.td, color: colors.subtext0 }}>
                    {task.priority > 7 ? (
                      <span style={{ color: colors.red }}>High ({task.priority})</span>
                    ) : task.priority > 4 ? (
                      <span style={{ color: colors.yellow }}>Med ({task.priority})</span>
                    ) : (
                      <span>Low ({task.priority})</span>
                    )}
                  </td>
                  <td style={{ ...baseStyles.td, color: colors.subtext0 }}>
                    {task.assigned_to || '—'}
                  </td>
                  <td style={{ ...baseStyles.td, color: colors.subtext0, fontSize: '12px', fontFamily: 'monospace' }}>
                    {task.project_id || '—'}
                  </td>
                  <td style={{ ...baseStyles.td, color: colors.subtext0, fontSize: '12px' }}>
                    {task.updated_at
                      ? new Date(task.updated_at).toLocaleString()
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <NewTaskModal
          onClose={() => setShowModal(false)}
          onSubmit={(input) => createTask(input)}
        />
      )}
    </div>
  );
}
