import { useEffect } from 'react';
import { useAgentStore } from '../store/agentStore';
import { useTaskStore } from '../store/taskStore';
import { colors, statusColors, baseStyles } from '../theme';
import { AgentStatus } from '../types';

type NavItem = 'dashboard' | 'agents' | 'tasks' | 'messages' | 'settings';

interface DashboardProps {
  onNavigate: (page: NavItem) => void;
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color?: string;
}) {
  return (
    <div
      style={{
        ...baseStyles.card,
        flex: 1,
        minWidth: '160px',
      }}
    >
      <div
        style={{
          fontSize: '28px',
          fontWeight: '700',
          color: color ?? colors.text,
          marginBottom: '4px',
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: '13px', color: colors.subtext0 }}>{label}</div>
    </div>
  );
}

function StatusDot({ status }: { status: AgentStatus }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: statusColors[status] ?? colors.overlay0,
        marginRight: '6px',
      }}
    />
  );
}

export default function Dashboard({ onNavigate }: DashboardProps) {
  const { agents, fetchAgents } = useAgentStore();
  const { tasks, fetchTasks } = useTaskStore();

  useEffect(() => {
    fetchAgents();
    fetchTasks();
  }, [fetchAgents, fetchTasks]);

  const activeAgents = agents.filter((a) => a.status === 'working').length;
  const pendingTasks = tasks.filter((t) => t.status === 'pending').length;
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const failedTasks = tasks.filter((t) => t.status === 'failed').length;

  const recentTasks = [...tasks]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 5);

  return (
    <div style={{ maxWidth: '1200px' }}>
      {/* Stat cards */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <StatCard label="Total Agents" value={agents.length} color={colors.blue} />
        <StatCard label="Active Agents" value={activeAgents} color={colors.green} />
        <StatCard label="Pending Tasks" value={pendingTasks} color={colors.yellow} />
        <StatCard label="Completed Tasks" value={completedTasks} color={colors.teal} />
        {failedTasks > 0 && (
          <StatCard label="Failed Tasks" value={failedTasks} color={colors.red} />
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Team Health */}
        <div style={baseStyles.card}>
          <h3
            style={{
              margin: '0 0 16px',
              fontSize: '14px',
              fontWeight: '600',
              color: colors.subtext1,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Team Health
          </h3>
          {agents.length === 0 ? (
            <p style={{ color: colors.overlay0, fontSize: '14px' }}>No agents running</p>
          ) : (
            agents.map((agent) => (
              <div
                key={agent.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: `1px solid ${colors.surface1}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <StatusDot status={agent.status} />
                  <span style={{ fontSize: '14px', color: colors.text }}>{agent.name}</span>
                  {agent.is_lead && (
                    <span
                      style={{
                        marginLeft: '8px',
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
                <span
                  style={{
                    fontSize: '12px',
                    color: statusColors[agent.status] ?? colors.overlay0,
                    textTransform: 'capitalize',
                  }}
                >
                  {agent.status}
                </span>
              </div>
            ))
          )}
          {agents.length > 0 && (
            <button
              onClick={() => onNavigate('agents')}
              style={{
                marginTop: '12px',
                color: colors.blue,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '13px',
                padding: 0,
              }}
            >
              View all agents &rarr;
            </button>
          )}
        </div>

        {/* Recent Activity */}
        <div style={baseStyles.card}>
          <h3
            style={{
              margin: '0 0 16px',
              fontSize: '14px',
              fontWeight: '600',
              color: colors.subtext1,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Recent Activity
          </h3>
          {recentTasks.length === 0 ? (
            <p style={{ color: colors.overlay0, fontSize: '14px' }}>No tasks yet</p>
          ) : (
            recentTasks.map((task) => (
              <div
                key={task.id}
                style={{
                  padding: '8px 0',
                  borderBottom: `1px solid ${colors.surface1}`,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '2px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '14px',
                      color: colors.text,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '200px',
                    }}
                  >
                    {task.title}
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      color: statusColors[task.status] ?? colors.overlay0,
                      backgroundColor: `${statusColors[task.status] ?? colors.overlay0}22`,
                      padding: '2px 8px',
                      borderRadius: '10px',
                      textTransform: 'capitalize',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {task.status.replace('_', ' ')}
                  </span>
                </div>
                {task.assigned_to && (
                  <div style={{ fontSize: '12px', color: colors.overlay1 }}>
                    &rarr; {task.assigned_to}
                  </div>
                )}
              </div>
            ))
          )}
          {tasks.length > 0 && (
            <button
              onClick={() => onNavigate('tasks')}
              style={{
                marginTop: '12px',
                color: colors.blue,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '13px',
                padding: 0,
              }}
            >
              View all tasks &rarr;
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
