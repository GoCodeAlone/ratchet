import { useEffect, useState, FormEvent } from 'react';
import { useAgentStore } from '../store/agentStore';
import { useProviderStore } from '../store/providerStore';
import { colors, statusColors, baseStyles } from '../theme';
import { AgentInfo, AgentStatus, TranscriptEntry } from '../types';
import { createAgent, updateAgent, deleteAgent, fetchAgentTranscripts } from '../utils/api';

function StatusBadge({ status }: { status: AgentStatus }) {
  const color = statusColors[status] ?? colors.overlay0;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        fontSize: '12px',
        color,
        backgroundColor: `${color}22`,
        padding: '2px 10px',
        borderRadius: '10px',
        textTransform: 'capitalize',
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: color,
          display: 'inline-block',
        }}
      />
      {status}
    </span>
  );
}

function AgentModal({ onClose, onSubmit, agent }: {
  onClose: () => void;
  onSubmit: (data: { name: string; role?: string; system_prompt?: string; team_id?: string; provider?: string; model?: string }) => Promise<void>;
  agent?: AgentInfo;
}) {
  const isEdit = !!agent;
  const [name, setName] = useState(agent?.name ?? '');
  const [role, setRole] = useState(agent?.role ?? '');
  const [systemPrompt, setSystemPrompt] = useState(agent?.system_prompt ?? '');
  const [teamId, setTeamId] = useState(agent?.team_id ?? '');
  const [selectedProvider, setSelectedProvider] = useState(agent?.provider ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { providers, fetchProviders } = useProviderStore();

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      const chosen = providers.find((p) => p.alias === selectedProvider);
      if (isEdit) {
        // Edit: always send all fields so cleared values take effect
        await onSubmit({
          name: name.trim(),
          role: role.trim(),
          system_prompt: systemPrompt.trim(),
          team_id: teamId.trim(),
          provider: selectedProvider,
          model: chosen?.model ?? '',
        });
      } else {
        // Create: omit empty fields so backend defaults apply
        await onSubmit({
          name: name.trim(),
          role: role.trim() || undefined,
          system_prompt: systemPrompt.trim() || undefined,
          team_id: teamId.trim() || undefined,
          provider: selectedProvider || undefined,
          model: chosen?.model || undefined,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : isEdit ? 'Failed to update agent' : 'Failed to create agent');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ ...baseStyles.card, width: '480px', padding: '28px' }}>
        <h3 style={{ margin: '0 0 20px', color: colors.text, fontSize: '16px' }}>{isEdit ? 'Edit Agent' : 'New Agent'}</h3>
        {error && (
          <div style={{ color: colors.red, fontSize: '13px', marginBottom: '12px', padding: '8px 12px', backgroundColor: `${colors.red}11`, borderRadius: '6px' }}>
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', color: colors.subtext1, fontSize: '13px', marginBottom: '6px' }}>Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name" required autoFocus style={baseStyles.input} />
          </div>
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', color: colors.subtext1, fontSize: '13px', marginBottom: '6px' }}>Role</label>
            <input type="text" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. researcher, coder" style={baseStyles.input} />
          </div>
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', color: colors.subtext1, fontSize: '13px', marginBottom: '6px' }}>Team ID</label>
            <input type="text" value={teamId} onChange={(e) => setTeamId(e.target.value)} placeholder="Optional team assignment" style={baseStyles.input} />
          </div>
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', color: colors.subtext1, fontSize: '13px', marginBottom: '6px' }}>Provider</label>
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              style={{ ...baseStyles.input, cursor: 'pointer' }}
            >
              <option value="">(Default)</option>
              {providers.map((p) => (
                <option key={p.alias} value={p.alias}>
                  {p.alias} ({p.type} / {p.model})
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', color: colors.subtext1, fontSize: '13px', marginBottom: '6px' }}>System Prompt</label>
            <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} placeholder="Optional system prompt" rows={4} style={{ ...baseStyles.input, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={baseStyles.button.secondary}>Cancel</button>
            <button type="submit" disabled={loading || !name.trim()} style={{ ...baseStyles.button.primary, opacity: loading || !name.trim() ? 0.6 : 1 }}>
              {loading ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save Changes' : 'Create Agent')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AgentDetailPanel({ agent, onClose }: { agent: AgentInfo; onClose: () => void }) {
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [transcriptsLoading, setTranscriptsLoading] = useState(false);

  useEffect(() => {
    setTranscriptsLoading(true);
    fetchAgentTranscripts(agent.id)
      .then((data) => setTranscripts(data ?? []))
      .catch(() => {})
      .finally(() => setTranscriptsLoading(false));
  }, [agent.id]);

  const roleColors: Record<string, string> = {
    system: colors.mauve,
    user: colors.blue,
    assistant: colors.green,
    tool: colors.peach,
  };

  return (
    <div
      style={{
        ...baseStyles.card,
        marginTop: '0',
        borderLeft: `3px solid ${colors.blue}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ margin: '0 0 4px', color: colors.text, fontSize: '16px' }}>{agent.name}</h3>
          <p style={{ margin: '0 0 12px', color: colors.overlay1, fontSize: '13px' }}>
            {agent.role}
          </p>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: colors.overlay0,
            cursor: 'pointer',
            fontSize: '18px',
            lineHeight: 1,
          }}
        >
          &times;
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px' }}>
        <div>
          <div style={{ color: colors.subtext0, marginBottom: '3px' }}>Provider</div>
          <div style={{ color: colors.text, fontFamily: 'monospace' }}>{agent.provider || 'default'}</div>
        </div>
        <div>
          <div style={{ color: colors.subtext0, marginBottom: '3px' }}>Model</div>
          <div style={{ color: colors.text, fontFamily: 'monospace' }}>{agent.model}</div>
        </div>
        <div>
          <div style={{ color: colors.subtext0, marginBottom: '3px' }}>Team</div>
          <div style={{ color: colors.text }}>{agent.team_id || 'Unassigned'}</div>
        </div>
        <div>
          <div style={{ color: colors.subtext0, marginBottom: '3px' }}>Status</div>
          <StatusBadge status={agent.status} />
        </div>
        <div>
          <div style={{ color: colors.subtext0, marginBottom: '3px' }}>Role</div>
          <div style={{ color: agent.is_lead ? colors.mauve : colors.text }}>
            {agent.is_lead ? 'Team Lead' : 'Member'}
          </div>
        </div>
        {agent.current_task && (
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ color: colors.subtext0, marginBottom: '3px' }}>Current Task</div>
            <div style={{ color: colors.text }}>{agent.current_task}</div>
          </div>
        )}
        {agent.started_at && (
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ color: colors.subtext0, marginBottom: '3px' }}>Started At</div>
            <div style={{ color: colors.text }}>
              {new Date(agent.started_at).toLocaleString()}
            </div>
          </div>
        )}
      </div>

      {/* Transcripts section */}
      <div style={{ marginTop: '16px', borderTop: `1px solid ${colors.surface1}`, paddingTop: '16px' }}>
        <div style={{ fontSize: '12px', fontWeight: '600', color: colors.subtext0, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
          Recent Transcripts
        </div>
        {transcriptsLoading ? (
          <div style={{ color: colors.overlay0, fontSize: '13px' }}>Loading...</div>
        ) : transcripts.length === 0 ? (
          <div style={{ color: colors.overlay0, fontSize: '13px' }}>No transcripts yet</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '300px', overflowY: 'auto' }}>
            {transcripts.slice(0, 10).map((entry) => (
              <div key={entry.id} style={{ padding: '8px 10px', backgroundColor: colors.mantle, borderRadius: '6px', borderLeft: `2px solid ${roleColors[entry.role] ?? colors.overlay0}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '600', color: roleColors[entry.role] ?? colors.overlay0, textTransform: 'uppercase' }}>{entry.role}</span>
                  <span style={{ fontSize: '11px', color: colors.overlay0 }}>{new Date(entry.created_at).toLocaleString()}</span>
                </div>
                <div style={{ fontSize: '12px', color: colors.subtext1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.content}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AgentList() {
  const { agents, loading, error, fetchAgents, startAgent, stopAgent } = useAgentStore();
  const [selected, setSelected] = useState<AgentInfo | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editAgent, setEditAgent] = useState<AgentInfo | null>(null);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  async function handleStart(id: string) {
    setActionLoading(id + '-start');
    try {
      await startAgent(id);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleStop(id: string) {
    setActionLoading(id + '-stop');
    try {
      await stopAgent(id);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCreate(data: { name: string; role?: string; system_prompt?: string; team_id?: string; provider?: string; model?: string }) {
    await createAgent(data);
    await fetchAgents();
  }

  async function handleUpdate(data: { name: string; role?: string; system_prompt?: string; team_id?: string; provider?: string; model?: string }) {
    if (!editAgent) return;
    await updateAgent(editAgent.id, data);
    if (selected?.id === editAgent.id) setSelected(null);
    await fetchAgents();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this agent?')) return;
    setActionLoading(id + '-delete');
    try {
      await deleteAgent(id);
      if (selected?.id === id) setSelected(null);
      await fetchAgents();
    } finally {
      setActionLoading(null);
    }
  }

  if (loading && agents.length === 0) {
    return (
      <div style={{ color: colors.subtext0, padding: '40px', textAlign: 'center' }}>
        Loading agents...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          color: colors.red,
          padding: '16px',
          backgroundColor: `${colors.red}11`,
          borderRadius: '8px',
          border: `1px solid ${colors.red}44`,
        }}
      >
        {error}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1100px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{ color: colors.subtext0, fontSize: '14px' }}>
          {agents.length} agent{agents.length !== 1 ? 's' : ''} registered
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => fetchAgents()}
            style={{ ...baseStyles.button.secondary, fontSize: '13px', padding: '6px 12px' }}
          >
            Refresh
          </button>
          <button
            onClick={() => setShowModal(true)}
            style={{ ...baseStyles.button.primary, fontSize: '13px' }}
          >
            + New Agent
          </button>
        </div>
      </div>

      {selected && (
        <div style={{ marginBottom: '16px' }}>
          <AgentDetailPanel agent={selected} onClose={() => setSelected(null)} />
        </div>
      )}

      {agents.length === 0 ? (
        <div
          style={{
            ...baseStyles.card,
            textAlign: 'center',
            padding: '60px',
            color: colors.overlay0,
          }}
        >
          No agents registered. Start the Ratchet server with an agent config.
        </div>
      ) : (
        <div style={{ ...baseStyles.card, padding: 0, overflow: 'hidden' }}>
          <table style={baseStyles.table}>
            <thead>
              <tr style={{ backgroundColor: colors.mantle }}>
                <th style={baseStyles.th}>Name</th>
                <th style={baseStyles.th}>Role</th>
                <th style={baseStyles.th}>Provider</th>
                <th style={baseStyles.th}>Status</th>
                <th style={baseStyles.th}>Current Task</th>
                <th style={baseStyles.th}>Team</th>
                <th style={baseStyles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr
                  key={agent.id}
                  onClick={() => setSelected(selected?.id === agent.id ? null : agent)}
                  style={{
                    cursor: 'pointer',
                    backgroundColor:
                      selected?.id === agent.id ? `${colors.blue}11` : 'transparent',
                  }}
                >
                  <td style={baseStyles.td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: '500' }}>{agent.name}</span>
                      {!!agent.is_lead && (
                        <span
                          style={{
                            fontSize: '11px',
                            color: colors.mauve,
                            backgroundColor: `${colors.mauve}22`,
                            padding: '1px 6px',
                            borderRadius: '10px',
                          }}
                        >
                          lead
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ ...baseStyles.td, color: colors.subtext0 }}>
                    {agent.role}
                  </td>
                  <td style={{ ...baseStyles.td, color: colors.subtext0, fontFamily: 'monospace', fontSize: '12px' }}>
                    {agent.provider || 'default'}
                  </td>
                  <td style={baseStyles.td}>
                    <StatusBadge status={agent.status} />
                  </td>
                  <td
                    style={{
                      ...baseStyles.td,
                      color: colors.subtext0,
                      maxWidth: '200px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {agent.current_task || '—'}
                  </td>
                  <td style={{ ...baseStyles.td, color: colors.subtext0 }}>
                    {agent.team_id || '—'}
                  </td>
                  <td style={baseStyles.td} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {agent.status === 'stopped' || agent.status === 'error' ? (
                        <button
                          onClick={() => handleStart(agent.id)}
                          disabled={actionLoading === agent.id + '-start'}
                          style={{
                            ...baseStyles.button.primary,
                            padding: '4px 12px',
                            fontSize: '12px',
                            opacity: actionLoading === agent.id + '-start' ? 0.6 : 1,
                          }}
                        >
                          Start
                        </button>
                      ) : (
                        <button
                          onClick={() => handleStop(agent.id)}
                          disabled={actionLoading === agent.id + '-stop'}
                          style={{
                            ...baseStyles.button.danger,
                            padding: '4px 12px',
                            fontSize: '12px',
                            opacity: actionLoading === agent.id + '-stop' ? 0.6 : 1,
                          }}
                        >
                          Stop
                        </button>
                      )}
                      {(agent.status === 'idle' || agent.status === 'stopped' || agent.status === 'error') && (
                        <button
                          onClick={() => setEditAgent(agent)}
                          style={{
                            ...baseStyles.button.secondary,
                            padding: '4px 12px',
                            fontSize: '12px',
                          }}
                        >
                          Edit
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(agent.id)}
                        disabled={actionLoading === agent.id + '-delete'}
                        style={{
                          backgroundColor: 'transparent',
                          color: colors.red,
                          border: `1px solid ${colors.red}44`,
                          borderRadius: '6px',
                          padding: '4px 10px',
                          fontSize: '12px',
                          cursor: 'pointer',
                          opacity: actionLoading === agent.id + '-delete' ? 0.6 : 1,
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && <AgentModal onClose={() => setShowModal(false)} onSubmit={handleCreate} />}
      {editAgent && <AgentModal onClose={() => setEditAgent(null)} onSubmit={handleUpdate} agent={editAgent} />}
    </div>
  );
}
