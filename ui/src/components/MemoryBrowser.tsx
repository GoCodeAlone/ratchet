import { useEffect, useState } from 'react';
import { colors, baseStyles } from '../theme';
import { apiGet, apiDelete } from '../utils/api';

interface MemoryEntry {
  id: string;
  agent_id: string;
  content: string;
  category: string;
  created_at: string;
}

interface AgentOption {
  id: string;
  name: string;
}

const categoryColors: Record<string, string> = {
  fact: colors.blue,
  insight: colors.teal,
  pattern: colors.mauve,
  rule: colors.peach,
};

function CategoryBadge({ category }: { category: string }) {
  const color = categoryColors[category] ?? colors.overlay1;
  return (
    <span
      style={{
        fontSize: '11px',
        color,
        backgroundColor: `${color}22`,
        padding: '2px 8px',
        borderRadius: '10px',
        textTransform: 'capitalize',
      }}
    >
      {category || 'unknown'}
    </span>
  );
}

export default function MemoryBrowser() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);

  async function loadEntries() {
    try {
      const data = await apiGet<MemoryEntry[]>('/memory');
      setEntries(Array.isArray(data) ? data : []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memory entries');
    } finally {
      setLoading(false);
    }
  }

  async function loadAgents() {
    try {
      const data = await apiGet<AgentOption[]>('/agents');
      setAgents(Array.isArray(data) ? data : []);
    } catch {
      // Agents list is optional for filtering
    }
  }

  useEffect(() => {
    loadEntries();
    loadAgents();
  }, []);

  async function handleDelete(id: string) {
    if (!confirm('Delete this memory entry?')) return;
    setDeleteLoading(id);
    try {
      await apiDelete(`/memory/${id}`);
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete entry');
    } finally {
      setDeleteLoading(null);
    }
  }

  const filtered = entries.filter((e) => {
    if (agentFilter !== 'all' && e.agent_id !== agentFilter) return false;
    if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
    if (search && !e.content.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const categories = [...new Set(entries.map((e) => e.category).filter(Boolean))];

  if (loading && entries.length === 0) {
    return <div style={{ color: colors.subtext0, padding: '40px', textAlign: 'center' }}>Loading memory entries...</div>;
  }

  return (
    <div style={{ maxWidth: '1000px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ color: colors.subtext0, fontSize: '14px' }}>
          {entries.length} memor{entries.length !== 1 ? 'ies' : 'y'} stored
        </div>
        <button
          onClick={() => { setLoading(true); loadEntries(); }}
          style={{ ...baseStyles.button.secondary, fontSize: '13px', padding: '6px 12px' }}
        >
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          style={{ ...baseStyles.input, width: '160px', padding: '6px 12px', fontSize: '13px', cursor: 'pointer' }}
        >
          <option value="all">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name || a.id}</option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ ...baseStyles.input, width: '140px', padding: '6px 12px', fontSize: '13px', cursor: 'pointer' }}
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search memories..."
          data-1p-ignore
          style={{ ...baseStyles.input, flex: 1, minWidth: '180px', padding: '6px 12px', fontSize: '13px' }}
        />
      </div>

      {/* Error */}
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

      {/* List */}
      {filtered.length === 0 ? (
        <div
          style={{
            ...baseStyles.card,
            textAlign: 'center',
            padding: '60px',
            color: colors.overlay0,
          }}
        >
          {entries.length === 0
            ? 'No memory entries yet. Memories are automatically extracted after agents complete tasks.'
            : 'No entries match the current filters.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map((entry) => {
            const isExpanded = expandedId === entry.id;
            const preview = entry.content.length > 200 ? entry.content.slice(0, 200) + '...' : entry.content;
            const agentName = agents.find((a) => a.id === entry.agent_id)?.name || entry.agent_id;

            return (
              <div
                key={entry.id}
                style={{
                  ...baseStyles.card,
                  padding: '14px 16px',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
                onClick={() => setExpandedId(isExpanded ? null : entry.id)}
              >
                {/* Top row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '500', color: colors.text }}>
                      {agentName}
                    </span>
                    <CategoryBadge category={entry.category} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: colors.overlay0 }}>
                      {new Date(entry.created_at).toLocaleString()}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(entry.id); }}
                      disabled={deleteLoading === entry.id}
                      style={{
                        backgroundColor: 'transparent',
                        color: colors.red,
                        border: `1px solid ${colors.red}44`,
                        borderRadius: '6px',
                        padding: '3px 8px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        opacity: deleteLoading === entry.id ? 0.6 : 1,
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div
                  style={{
                    fontSize: '13px',
                    color: colors.subtext1,
                    lineHeight: '1.5',
                    whiteSpace: isExpanded ? 'pre-wrap' : 'normal',
                    wordBreak: 'break-word',
                  }}
                >
                  {isExpanded ? entry.content : preview}
                </div>
                {entry.content.length > 200 && (
                  <div style={{ fontSize: '11px', color: colors.blue, marginTop: '6px' }}>
                    {isExpanded ? 'Click to collapse' : 'Click to expand'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
