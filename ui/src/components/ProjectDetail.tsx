import { useEffect, useState } from 'react';
import { colors, statusColors, baseStyles } from '../theme';
import { Project, Task, TranscriptEntry } from '../types';
import { fetchProjectTasks, fetchProjectTranscripts } from '../utils/api';

type Tab = 'tasks' | 'transcripts';

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

export default function ProjectDetail({ project, onBack }: { project: Project; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('tasks');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchProjectTasks(project.id).then(setTasks).catch(() => {}),
      fetchProjectTranscripts(project.id).then(setTranscripts).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [project.id]);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'tasks', label: 'Tasks', count: tasks.length },
    { id: 'transcripts', label: 'Transcripts', count: transcripts.length },
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
            {t.label} ({t.count})
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
      ) : (
        <TranscriptView entries={transcripts} />
      )}
    </div>
  );
}
