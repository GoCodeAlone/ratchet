import { useEffect, useState, FormEvent } from 'react';
import { colors, statusColors, baseStyles } from '../theme';
import { Project } from '../types';
import { fetchProjects, createProject } from '../utils/api';
import ProjectDetail from './ProjectDetail';

function NewProjectModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (name: string, description: string, workspaceImage: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workspaceImage, setWorkspaceImage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      await onSubmit(name.trim(), description.trim(), workspaceImage.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ ...baseStyles.card, width: '480px', padding: '28px' }}>
        <h3 style={{ margin: '0 0 20px', color: colors.text, fontSize: '16px' }}>New Project</h3>
        {error && (
          <div style={{ color: colors.red, fontSize: '13px', marginBottom: '12px', padding: '8px 12px', backgroundColor: `${colors.red}11`, borderRadius: '6px' }}>
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', color: colors.subtext1, fontSize: '13px', marginBottom: '6px' }}>Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" required autoFocus style={baseStyles.input} />
          </div>
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', color: colors.subtext1, fontSize: '13px', marginBottom: '6px' }}>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional project description" rows={3} style={{ ...baseStyles.input, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', color: colors.subtext1, fontSize: '13px', marginBottom: '6px' }}>Workspace Image</label>
            <input type="text" value={workspaceImage} onChange={(e) => setWorkspaceImage(e.target.value)} placeholder="e.g. ubuntu:22.04 (optional)" style={baseStyles.input} />
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={baseStyles.button.secondary}>Cancel</button>
            <button type="submit" disabled={loading || !name.trim()} style={{ ...baseStyles.button.primary, opacity: loading || !name.trim() ? 0.6 : 1 }}>
              {loading ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState<Project | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchProjects();
      setProjects(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(name: string, description: string, workspaceImage: string) {
    const data: Parameters<typeof createProject>[0] = { name, description };
    if (workspaceImage) {
      data.workspace_spec = { image: workspaceImage };
    }
    await createProject(data);
    await load();
  }

  if (selected) {
    return <ProjectDetail project={selected} onBack={() => { setSelected(null); load(); }} />;
  }

  return (
    <div style={{ maxWidth: '1100px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{ color: colors.subtext0, fontSize: '14px' }}>
          {projects.length} project{projects.length !== 1 ? 's' : ''}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={load} style={{ ...baseStyles.button.secondary, fontSize: '13px', padding: '6px 12px' }}>Refresh</button>
          <button onClick={() => setShowModal(true)} style={{ ...baseStyles.button.primary, fontSize: '13px' }}>+ New Project</button>
        </div>
      </div>

      {loading && projects.length === 0 ? (
        <div style={{ color: colors.subtext0, textAlign: 'center', padding: '40px' }}>Loading projects...</div>
      ) : error ? (
        <div style={{ color: colors.red, padding: '16px', backgroundColor: `${colors.red}11`, borderRadius: '8px', border: `1px solid ${colors.red}44` }}>{error}</div>
      ) : projects.length === 0 ? (
        <div style={{ ...baseStyles.card, textAlign: 'center', padding: '60px', color: colors.overlay0 }}>
          No projects yet. Create one to get started.
        </div>
      ) : (
        <div style={{ ...baseStyles.card, padding: 0, overflow: 'hidden' }}>
          <table style={baseStyles.table}>
            <thead>
              <tr style={{ backgroundColor: colors.mantle }}>
                <th style={baseStyles.th}>Name</th>
                <th style={baseStyles.th}>Description</th>
                <th style={baseStyles.th}>Image</th>
                <th style={baseStyles.th}>Status</th>
                <th style={baseStyles.th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} onClick={() => setSelected(p)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...baseStyles.td, fontWeight: '500' }}>{p.name}</td>
                  <td style={{ ...baseStyles.td, color: colors.subtext0, maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.description || '—'}
                  </td>
                  <td style={{ ...baseStyles.td, color: colors.subtext0, fontFamily: 'monospace', fontSize: '12px' }}>
                    {p.workspace_spec?.image || '—'}
                  </td>
                  <td style={baseStyles.td}>
                    <span style={{ fontSize: '12px', color: statusColors[p.status] ?? colors.overlay0, backgroundColor: `${statusColors[p.status] ?? colors.overlay0}22`, padding: '2px 10px', borderRadius: '10px', textTransform: 'capitalize' }}>
                      {p.status}
                    </span>
                  </td>
                  <td style={{ ...baseStyles.td, color: colors.subtext0, fontSize: '12px' }}>
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && <NewProjectModal onClose={() => setShowModal(false)} onSubmit={handleCreate} />}
    </div>
  );
}
