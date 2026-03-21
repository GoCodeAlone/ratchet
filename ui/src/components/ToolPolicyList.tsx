import { useEffect, useState } from 'react';
import { colors, baseStyles } from '../theme';
import { apiGet, apiPost, apiDelete } from '../utils/api';

interface ToolPolicy {
  id: string;
  scope: string;
  scope_id: string;
  tool_pattern: string;
  action: string;
  created_at: string;
}

interface FormState {
  scope: string;
  scope_id: string;
  tool_pattern: string;
  action: string;
}

const emptyForm: FormState = {
  scope: 'global',
  scope_id: '',
  tool_pattern: '*',
  action: 'allow',
};

const SCOPE_OPTIONS = ['global', 'team', 'agent'] as const;
const ACTION_OPTIONS = ['allow', 'deny'] as const;

const scopeColors: Record<string, string> = {
  global: colors.blue,
  team: colors.teal,
  agent: colors.mauve,
};

function ScopeBadge({ scope }: { scope: string }) {
  const color = scopeColors[scope] ?? colors.overlay1;
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
      {scope}
    </span>
  );
}

function ActionBadge({ action }: { action: string }) {
  const color = action === 'allow' ? colors.green : colors.red;
  return (
    <span
      style={{
        fontSize: '11px',
        color,
        backgroundColor: `${color}22`,
        padding: '2px 8px',
        borderRadius: '10px',
        textTransform: 'uppercase',
        fontWeight: '600',
        letterSpacing: '0.03em',
      }}
    >
      {action}
    </span>
  );
}

export default function ToolPolicyList() {
  const [policies, setPolicies] = useState<ToolPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<string>('all');

  async function load() {
    try {
      const data = await apiGet<ToolPolicy[]>('/tool-policies');
      setPolicies(Array.isArray(data) ? data : []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load policies');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function handleNew() {
    setForm({ ...emptyForm });
    setShowForm(true);
  }

  function handleCancel() {
    setShowForm(false);
    setForm({ ...emptyForm });
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      await apiPost('/tool-policies', {
        scope: form.scope,
        scope_id: form.scope !== 'global' ? form.scope_id.trim() : '',
        tool_pattern: form.tool_pattern.trim(),
        action: form.action,
      });
      handleCancel();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create policy');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this tool policy?')) return;
    setDeleteLoading(id);
    try {
      await apiDelete(`/tool-policies/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete policy');
    } finally {
      setDeleteLoading(null);
    }
  }

  const filtered = scopeFilter === 'all' ? policies : policies.filter((p) => p.scope === scopeFilter);
  const canSave = form.tool_pattern.trim().length > 0 && (form.scope === 'global' || form.scope_id.trim().length > 0);

  if (loading && policies.length === 0) {
    return <div style={{ color: colors.subtext0, padding: '40px', textAlign: 'center' }}>Loading tool policies...</div>;
  }

  return (
    <div style={{ maxWidth: '900px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ color: colors.subtext0, fontSize: '14px' }}>
          {policies.length} polic{policies.length !== 1 ? 'ies' : 'y'} configured
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value)}
            style={{ ...baseStyles.input, width: '120px', padding: '6px 12px', fontSize: '13px', cursor: 'pointer' }}
          >
            <option value="all">All scopes</option>
            {SCOPE_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            onClick={load}
            style={{ ...baseStyles.button.secondary, fontSize: '13px', padding: '6px 12px' }}
          >
            Refresh
          </button>
          <button
            onClick={handleNew}
            style={{ ...baseStyles.button.primary, fontSize: '13px', padding: '6px 12px' }}
          >
            + Add Policy
          </button>
        </div>
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

      {/* Add form */}
      {showForm && (
        <div
          style={{
            ...baseStyles.card,
            marginBottom: '16px',
            padding: '20px',
            border: `1px solid ${colors.surface1}`,
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: '600', color: colors.text, marginBottom: '16px' }}>
            Add Tool Policy
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', color: colors.subtext1, fontSize: '12px', marginBottom: '4px' }}>
                Scope *
              </label>
              <select
                value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value, scope_id: '' })}
                style={{ ...baseStyles.input, cursor: 'pointer' }}
              >
                {SCOPE_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', color: colors.subtext1, fontSize: '12px', marginBottom: '4px' }}>
                Action *
              </label>
              <select
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value })}
                style={{ ...baseStyles.input, cursor: 'pointer' }}
              >
                {ACTION_OPTIONS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>

          {form.scope !== 'global' && (
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', color: colors.subtext1, fontSize: '12px', marginBottom: '4px' }}>
                {form.scope === 'team' ? 'Team ID' : 'Agent ID'} *
              </label>
              <input
                type="text"
                value={form.scope_id}
                onChange={(e) => setForm({ ...form, scope_id: e.target.value })}
                placeholder={form.scope === 'team' ? 'e.g. alpha' : 'e.g. orchestrator'}
                data-1p-ignore
                style={baseStyles.input}
              />
            </div>
          )}

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', color: colors.subtext1, fontSize: '12px', marginBottom: '4px' }}>
              Tool Pattern *
            </label>
            <input
              type="text"
              value={form.tool_pattern}
              onChange={(e) => setForm({ ...form, tool_pattern: e.target.value })}
              placeholder="e.g. * or git_* or k8s_rollback"
              data-1p-ignore
              style={baseStyles.input}
              autoFocus
            />
            <div style={{ fontSize: '11px', color: colors.overlay0, marginTop: '4px' }}>
              Use * for all tools, prefix_* for groups, or exact tool names.
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              onClick={handleCancel}
              style={{ ...baseStyles.button.secondary, fontSize: '12px', padding: '6px 14px' }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave || saving}
              style={{
                ...baseStyles.button.primary,
                fontSize: '12px',
                padding: '6px 14px',
                opacity: canSave && !saving ? 1 : 0.6,
              }}
            >
              {saving ? 'Saving...' : 'Add Policy'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {filtered.length === 0 && !showForm ? (
        <div
          style={{
            ...baseStyles.card,
            textAlign: 'center',
            padding: '60px',
            color: colors.overlay0,
          }}
        >
          {scopeFilter !== 'all'
            ? `No policies with scope "${scopeFilter}".`
            : 'No tool policies configured. The default policy (allow) is active. Add policies to restrict specific tools.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map((policy) => (
            <div
              key={policy.id}
              style={{
                ...baseStyles.card,
                padding: '12px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                <ActionBadge action={policy.action} />
                <code
                  style={{
                    fontSize: '13px',
                    color: colors.text,
                    fontFamily: 'monospace',
                    backgroundColor: colors.mantle,
                    padding: '2px 8px',
                    borderRadius: '4px',
                  }}
                >
                  {policy.tool_pattern}
                </code>
                <ScopeBadge scope={policy.scope} />
                {policy.scope_id && (
                  <span style={{ fontSize: '12px', color: colors.subtext0, fontFamily: 'monospace' }}>
                    {policy.scope_id}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '11px', color: colors.overlay0 }}>
                  {new Date(policy.created_at).toLocaleDateString()}
                </span>
                <button
                  onClick={() => handleDelete(policy.id)}
                  disabled={deleteLoading === policy.id}
                  style={{
                    backgroundColor: 'transparent',
                    color: colors.red,
                    border: `1px solid ${colors.red}44`,
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '11px',
                    cursor: 'pointer',
                    opacity: deleteLoading === policy.id ? 0.6 : 1,
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
