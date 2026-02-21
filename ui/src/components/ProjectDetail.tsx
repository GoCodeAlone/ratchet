import { useEffect, useState, useRef, FormEvent } from 'react';
import { colors, statusColors, baseStyles } from '../theme';
import { Project, Task, TranscriptEntry, ProjectRepo, ContainerStatus } from '../types';
import {
  fetchProjectTasks,
  fetchProjectTranscripts,
  fetchProjectRepos,
  addProjectRepo,
  removeProjectRepo,
  startContainer,
  stopContainer,
  getContainerStatus,
} from '../utils/api';

type Tab = 'tasks' | 'transcripts' | 'repos' | 'workspace';

function TranscriptView({ entries }: { entries: TranscriptEntry[] }) {
  const roleColors: Record<string, string> = {
    system: colors.mauve,
    user: colors.blue,
    assistant: colors.green,
    tool: colors.peach,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {entries.length === 0 ? (
        <div style={{ color: colors.overlay0, textAlign: 'center', padding: '40px' }}>No transcripts yet</div>
      ) : (
        entries.map((entry) => (
          <div key={entry.id} style={{ ...baseStyles.card, padding: '12px', borderLeft: `3px solid ${roleColors[entry.role] ?? colors.overlay0}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: '600', color: roleColors[entry.role] ?? colors.overlay0, textTransform: 'uppercase' }}>
                  {entry.role}
                </span>
                {entry.redacted === 1 && (
                  <span style={{ fontSize: '11px', color: colors.red, backgroundColor: `${colors.red}22`, padding: '1px 6px', borderRadius: '10px' }}>
                    redacted
                  </span>
                )}
                <span style={{ fontSize: '11px', color: colors.overlay0 }}>iter {entry.iteration}</span>
              </div>
              <span style={{ fontSize: '11px', color: colors.overlay0 }}>
                {new Date(entry.created_at).toLocaleString()}
              </span>
            </div>
            <pre style={{ margin: 0, fontSize: '13px', color: colors.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', lineHeight: '1.5' }}>
              {entry.content}
            </pre>
            {entry.tool_calls && entry.tool_calls !== '[]' && (
              <div style={{ marginTop: '8px', padding: '8px', backgroundColor: colors.mantle, borderRadius: '4px' }}>
                <div style={{ fontSize: '11px', color: colors.peach, marginBottom: '4px' }}>Tool Calls</div>
                <pre style={{ margin: 0, fontSize: '12px', color: colors.subtext0, whiteSpace: 'pre-wrap' }}>
                  {entry.tool_calls}
                </pre>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      fontSize: '12px',
      color: statusColors[status] ?? colors.overlay0,
      backgroundColor: (statusColors[status] ?? colors.overlay0) + '22',
      padding: '2px 10px',
      borderRadius: '10px',
      textTransform: 'capitalize',
    }}>
      {status.replace('_', ' ')}
    </span>
  );
}

function ReposTab({ projectId }: { projectId: string }) {
  const [repos, setRepos] = useState<ProjectRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  async function loadRepos() {
    try {
      const data = await fetchProjectRepos(projectId);
      setRepos(data ?? []);
    } catch {
      setRepos([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadRepos(); }, [projectId]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!repoUrl.trim()) return;
    setAdding(true);
    setError('');
    try {
      await addProjectRepo(projectId, { repo_url: repoUrl.trim(), branch: branch.trim() || 'main' });
      setRepoUrl('');
      setBranch('main');
      await loadRepos();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add repo');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(repoId: string, repoUrlName: string) {
    if (!confirm(`Remove repo "${repoUrlName}"?`)) return;
    try {
      await removeProjectRepo(projectId, repoId);
      await loadRepos();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove repo');
    }
  }

  if (loading) {
    return <div style={{ color: colors.subtext0, textAlign: 'center', padding: '40px' }}>Loading repos...</div>;
  }

  return (
    <div>
      {/* Add repo form */}
      <div style={{ ...baseStyles.card, marginBottom: '16px' }}>
        <div style={{ fontSize: '14px', fontWeight: '500', color: colors.text, marginBottom: '12px' }}>Add Repository</div>
        {error && (
          <div style={{ color: colors.red, fontSize: '13px', marginBottom: '12px', padding: '8px 12px', backgroundColor: `${colors.red}11`, borderRadius: '6px' }}>
            {error}
          </div>
        )}
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <div style={{ flex: 2 }}>
            <label style={{ display: 'block', color: colors.subtext1, fontSize: '12px', marginBottom: '4px' }}>Repository URL</label>
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo.git"
              required
              style={baseStyles.input}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', color: colors.subtext1, fontSize: '12px', marginBottom: '4px' }}>Branch</label>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              style={baseStyles.input}
            />
          </div>
          <button
            type="submit"
            disabled={adding || !repoUrl.trim()}
            style={{ ...baseStyles.button.primary, opacity: adding || !repoUrl.trim() ? 0.6 : 1, whiteSpace: 'nowrap' }}
          >
            {adding ? 'Adding...' : 'Add'}
          </button>
        </form>
      </div>

      {/* Repos list */}
      {repos.length === 0 ? (
        <div style={{ ...baseStyles.card, textAlign: 'center', padding: '40px', color: colors.overlay0 }}>
          No repositories added yet
        </div>
      ) : (
        <div style={{ ...baseStyles.card, padding: 0, overflow: 'hidden' }}>
          <table style={baseStyles.table}>
            <thead>
              <tr style={{ backgroundColor: colors.mantle }}>
                <th style={baseStyles.th}>Repository URL</th>
                <th style={baseStyles.th}>Branch</th>
                <th style={baseStyles.th}>Clone Path</th>
                <th style={baseStyles.th}>Status</th>
                <th style={baseStyles.th}>Last Synced</th>
                <th style={baseStyles.th}></th>
              </tr>
            </thead>
            <tbody>
              {repos.map((repo) => (
                <tr key={repo.id}>
                  <td style={{ ...baseStyles.td, fontFamily: 'monospace', fontSize: '13px' }}>{repo.repo_url}</td>
                  <td style={{ ...baseStyles.td, color: colors.subtext0 }}>{repo.branch}</td>
                  <td style={{ ...baseStyles.td, fontFamily: 'monospace', fontSize: '13px', color: colors.subtext0 }}>{repo.clone_path || '—'}</td>
                  <td style={baseStyles.td}><StatusBadge status={repo.status} /></td>
                  <td style={{ ...baseStyles.td, color: colors.subtext0, fontSize: '12px' }}>
                    {repo.last_synced_at ? new Date(repo.last_synced_at).toLocaleString() : '—'}
                  </td>
                  <td style={{ ...baseStyles.td, textAlign: 'right' }}>
                    <button
                      onClick={() => handleDelete(repo.id, repo.repo_url)}
                      style={{ ...baseStyles.button.danger, fontSize: '12px', padding: '4px 10px' }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function WorkspaceTab({ project }: { project: Project }) {
  const [container, setContainer] = useState<ContainerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadStatus() {
    try {
      const status = await getContainerStatus(project.id);
      setContainer(status);
    } catch {
      setContainer(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [project.id]);

  // Auto-refresh when running
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (container?.status === 'running' || container?.status === 'pending') {
      intervalRef.current = setInterval(loadStatus, 5000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [container?.status]);

  async function handleStart() {
    setActionLoading(true);
    setError('');
    try {
      const status = await startContainer(project.id);
      setContainer(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start container');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStop() {
    setActionLoading(true);
    setError('');
    try {
      const status = await stopContainer(project.id);
      setContainer(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop container');
    } finally {
      setActionLoading(false);
    }
  }

  const spec = project.workspace_spec;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Workspace Spec */}
      <div style={baseStyles.card}>
        <div style={{ fontSize: '14px', fontWeight: '500', color: colors.text, marginBottom: '12px' }}>Workspace Specification</div>
        {spec ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {spec.image && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <span style={{ color: colors.subtext0, fontSize: '13px', minWidth: '120px' }}>Image:</span>
                <span style={{ fontFamily: 'monospace', fontSize: '13px', color: colors.text }}>{spec.image}</span>
              </div>
            )}
            {spec.init_commands && spec.init_commands.length > 0 && (
              <div>
                <span style={{ color: colors.subtext0, fontSize: '13px' }}>Init Commands:</span>
                <div style={{ marginTop: '4px', padding: '8px', backgroundColor: colors.mantle, borderRadius: '4px' }}>
                  {spec.init_commands.map((cmd, i) => (
                    <div key={i} style={{ fontFamily: 'monospace', fontSize: '13px', color: colors.text, padding: '2px 0' }}>
                      $ {cmd}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {spec.env && Object.keys(spec.env).length > 0 && (
              <div>
                <span style={{ color: colors.subtext0, fontSize: '13px' }}>Environment Variables:</span>
                <div style={{ marginTop: '4px', padding: '8px', backgroundColor: colors.mantle, borderRadius: '4px' }}>
                  {Object.entries(spec.env).map(([key, val]) => (
                    <div key={key} style={{ fontFamily: 'monospace', fontSize: '13px', color: colors.text, padding: '2px 0' }}>
                      {key}={val}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {spec.memory_limit && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <span style={{ color: colors.subtext0, fontSize: '13px', minWidth: '120px' }}>Memory Limit:</span>
                <span style={{ fontSize: '13px', color: colors.text }}>{spec.memory_limit} MB</span>
              </div>
            )}
            {spec.cpu_limit && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <span style={{ color: colors.subtext0, fontSize: '13px', minWidth: '120px' }}>CPU Limit:</span>
                <span style={{ fontSize: '13px', color: colors.text }}>{spec.cpu_limit} cores</span>
              </div>
            )}
            {spec.network_mode && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <span style={{ color: colors.subtext0, fontSize: '13px', minWidth: '120px' }}>Network Mode:</span>
                <span style={{ fontSize: '13px', color: colors.text }}>{spec.network_mode}</span>
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: colors.overlay0, fontSize: '13px' }}>No workspace specification configured</div>
        )}
      </div>

      {/* Container Status */}
      <div style={baseStyles.card}>
        <div style={{ fontSize: '14px', fontWeight: '500', color: colors.text, marginBottom: '12px' }}>Container</div>
        {error && (
          <div style={{ color: colors.red, fontSize: '13px', marginBottom: '12px', padding: '8px 12px', backgroundColor: `${colors.red}11`, borderRadius: '6px' }}>
            {error}
          </div>
        )}
        {loading ? (
          <div style={{ color: colors.subtext0, fontSize: '13px' }}>Loading container status...</div>
        ) : container ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ color: colors.subtext0, fontSize: '13px' }}>Status:</span>
              <StatusBadge status={container.status} />
            </div>
            {container.container_id && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <span style={{ color: colors.subtext0, fontSize: '13px', minWidth: '120px' }}>Container ID:</span>
                <span style={{ fontFamily: 'monospace', fontSize: '13px', color: colors.text }}>{container.container_id}</span>
              </div>
            )}
            {container.image && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <span style={{ color: colors.subtext0, fontSize: '13px', minWidth: '120px' }}>Image:</span>
                <span style={{ fontFamily: 'monospace', fontSize: '13px', color: colors.text }}>{container.image}</span>
              </div>
            )}
            {container.error_message && (
              <div style={{ color: colors.red, fontSize: '13px', padding: '8px 12px', backgroundColor: `${colors.red}11`, borderRadius: '6px' }}>
                {container.error_message}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              {(container.status === 'stopped' || container.status === 'error') && (
                <button
                  onClick={handleStart}
                  disabled={actionLoading}
                  style={{ ...baseStyles.button.primary, opacity: actionLoading ? 0.6 : 1 }}
                >
                  {actionLoading ? 'Starting...' : 'Start Container'}
                </button>
              )}
              {container.status === 'running' && (
                <button
                  onClick={handleStop}
                  disabled={actionLoading}
                  style={{ ...baseStyles.button.danger, opacity: actionLoading ? 0.6 : 1 }}
                >
                  {actionLoading ? 'Stopping...' : 'Stop Container'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ color: colors.overlay0, fontSize: '13px', marginBottom: '12px' }}>No container running</div>
            <button
              onClick={handleStart}
              disabled={actionLoading || !spec?.image}
              style={{ ...baseStyles.button.primary, opacity: actionLoading || !spec?.image ? 0.6 : 1 }}
            >
              {actionLoading ? 'Starting...' : 'Start Container'}
            </button>
            {!spec?.image && (
              <div style={{ color: colors.overlay0, fontSize: '12px', marginTop: '6px' }}>
                Set a workspace image to enable containers
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProjectDetail({ project, onBack }: { project: Project; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('tasks');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [repos, setRepos] = useState<ProjectRepo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchProjectTasks(project.id).then(setTasks).catch(() => {}),
      fetchProjectTranscripts(project.id).then(setTranscripts).catch(() => {}),
      fetchProjectRepos(project.id).then((data) => setRepos(data ?? [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [project.id]);

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'tasks', label: 'Tasks', count: tasks.length },
    { id: 'transcripts', label: 'Transcripts', count: transcripts.length },
    { id: 'repos', label: 'Repos', count: repos.length },
    { id: 'workspace', label: 'Workspace' },
  ];

  return (
    <div style={{ maxWidth: '1100px' }}>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: colors.blue, cursor: 'pointer', fontSize: '13px', padding: 0, marginBottom: '12px' }}>
          &larr; Back to Projects
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2 style={{ margin: 0, color: colors.text, fontSize: '20px' }}>{project.name}</h2>
          <span style={{ fontSize: '12px', color: statusColors[project.status] ?? colors.overlay0, backgroundColor: `${statusColors[project.status] ?? colors.overlay0}22`, padding: '2px 10px', borderRadius: '10px', textTransform: 'capitalize' }}>
            {project.status}
          </span>
        </div>
        {project.description && (
          <p style={{ margin: '6px 0 0', color: colors.subtext0, fontSize: '14px' }}>{project.description}</p>
        )}
        {project.workspace_path && (
          <div style={{ marginTop: '8px', fontSize: '12px', color: colors.overlay1, fontFamily: 'monospace' }}>
            Workspace: {project.workspace_path}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', marginBottom: '16px', borderBottom: `1px solid ${colors.surface1}` }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 20px',
              background: 'none',
              border: 'none',
              borderBottom: tab === t.id ? `2px solid ${colors.blue}` : '2px solid transparent',
              color: tab === t.id ? colors.text : colors.subtext0,
              fontSize: '14px',
              fontWeight: tab === t.id ? '500' : '400',
              cursor: 'pointer',
            }}
          >
            {t.label}{t.count !== undefined ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: colors.subtext0, textAlign: 'center', padding: '40px' }}>Loading...</div>
      ) : tab === 'tasks' ? (
        tasks.length === 0 ? (
          <div style={{ ...baseStyles.card, textAlign: 'center', padding: '40px', color: colors.overlay0 }}>No tasks in this project</div>
        ) : (
          <div style={{ ...baseStyles.card, padding: 0, overflow: 'hidden' }}>
            <table style={baseStyles.table}>
              <thead>
                <tr style={{ backgroundColor: colors.mantle }}>
                  <th style={baseStyles.th}>Title</th>
                  <th style={baseStyles.th}>Status</th>
                  <th style={baseStyles.th}>Priority</th>
                  <th style={baseStyles.th}>Assigned To</th>
                  <th style={baseStyles.th}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td style={{ ...baseStyles.td, fontWeight: '500' }}>{task.title}</td>
                    <td style={baseStyles.td}>
                      <span style={{ fontSize: '12px', color: statusColors[task.status] ?? colors.overlay0, backgroundColor: `${statusColors[task.status] ?? colors.overlay0}22`, padding: '2px 10px', borderRadius: '10px', textTransform: 'capitalize' }}>
                        {task.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td style={{ ...baseStyles.td, color: colors.subtext0 }}>{task.priority}</td>
                    <td style={{ ...baseStyles.td, color: colors.subtext0 }}>{task.assigned_to || '—'}</td>
                    <td style={{ ...baseStyles.td, color: colors.subtext0, fontSize: '12px' }}>
                      {task.updated_at ? new Date(task.updated_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : tab === 'transcripts' ? (
        <TranscriptView entries={transcripts} />
      ) : tab === 'repos' ? (
        <ReposTab projectId={project.id} />
      ) : (
        <WorkspaceTab project={project} />
      )}
    </div>
  );
}
