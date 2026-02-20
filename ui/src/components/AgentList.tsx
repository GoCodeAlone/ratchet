import { useEffect, useState } from 'react';
import { useAgentStore } from '../store/agentStore';
import { colors, statusColors, baseStyles } from '../theme';
import { AgentInfo, AgentStatus } from '../types';

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

function AgentDetailPanel({ agent, onClose }: { agent: AgentInfo; onClose: () => void }) {
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
            {agent.personality.role}
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
          <div style={{ color: colors.subtext0, marginBottom: '3px' }}>Model</div>
          <div style={{ color: colors.text, fontFamily: 'monospace' }}>{agent.personality.model}</div>
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
    </div>
  );
}

export default function AgentList() {
  const { agents, loading, error, fetchAgents, startAgent, stopAgent } = useAgentStore();
  const [selected, setSelected] = useState<AgentInfo | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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
        <button
          onClick={() => fetchAgents()}
          style={{ ...baseStyles.button.secondary, fontSize: '13px', padding: '6px 12px' }}
        >
          Refresh
        </button>
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
                      {agent.is_lead && (
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
                    {agent.personality.role}
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
                    </div>
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
