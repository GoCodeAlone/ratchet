import { useEffect, useState, FormEvent } from 'react';
import { useTaskStore } from '../store/taskStore';
import { useAgentStore } from '../store/agentStore';
import { colors, statusColors, baseStyles } from '../theme';
import { Task } from '../types';

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

function NewTaskModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (title: string, description: string) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    setError('');
    try {
      await onSubmit(title.trim(), description.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setLoading(false);
    }
  }

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
          width: '480px',
          padding: '28px',
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
            <label
              style={{
                display: 'block',
                color: colors.subtext1,
                fontSize: '13px',
                marginBottom: '6px',
              }}
            >
              Title *
            </label>
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

          <div style={{ marginBottom: '20px' }}>
            <label
              style={{
                display: 'block',
                color: colors.subtext1,
                fontSize: '13px',
                marginBottom: '6px',
              }}
            >
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional task description"
              rows={4}
              style={{
                ...baseStyles.input,
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
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
        <div
          style={{
            ...baseStyles.card,
            marginBottom: '16px',
            borderLeft: `3px solid ${statusColors[selected.status] ?? colors.overlay0}`,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <h3 style={{ margin: '0 0 8px', color: colors.text }}>{selected.title}</h3>
            <button
              onClick={() => setSelected(null)}
              style={{ background: 'none', border: 'none', color: colors.overlay0, cursor: 'pointer', fontSize: '18px' }}
            >
              &times;
            </button>
          </div>
          {selected.description && (
            <p style={{ color: colors.subtext0, fontSize: '14px', margin: '0 0 12px' }}>
              {selected.description}
            </p>
          )}
          {selected.result && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ color: colors.subtext0, fontSize: '12px', marginBottom: '4px' }}>Result</div>
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
                }}
              >
                {selected.result}
              </pre>
            </div>
          )}
          {selected.error && (
            <div>
              <div style={{ color: colors.red, fontSize: '12px', marginBottom: '4px' }}>Error</div>
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
                }}
              >
                {selected.error}
              </pre>
            </div>
          )}
        </div>
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
          onSubmit={createTask}
        />
      )}
    </div>
  );
}
