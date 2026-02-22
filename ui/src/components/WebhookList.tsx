import { useEffect, useState } from 'react';
import { colors, baseStyles } from '../theme';
import { apiGet, apiPost, apiDelete } from '../utils/api';

interface Webhook {
  id: string;
  source: 'github' | 'slack' | 'generic';
  name: string;
  secret_name: string;
  filter: string;
  task_template: string;
  enabled: boolean;
  created_at: string;
}

interface CreateWebhookBody {
  name: string;
  source: string;
  secret_name?: string;
  filter?: string;
  task_template?: string;
}

const fetchWebhooks = () => apiGet<Webhook[]>('/webhooks');
const createWebhook = (data: CreateWebhookBody) => apiPost<Webhook>('/webhooks', data);
const deleteWebhook = (id: string) => apiDelete<{ deleted: boolean }>(`/webhooks/${id}`);

const SOURCE_OPTIONS = ['github', 'slack', 'generic'] as const;

const sourceColors: Record<string, string> = {
  github: colors.mauve,
  slack: colors.peach,
  generic: colors.teal,
};

function SourceBadge({ source }: { source: string }) {
  const color = sourceColors[source] ?? colors.overlay1;
  return (
    <span
      style={{
        fontSize: '11px',
        color,
        backgroundColor: `${color}22`,
        padding: '2px 8px',
        borderRadius: '10px',
        textTransform: 'capitalize',
        fontFamily: 'monospace',
      }}
    >
      {source}
    </span>
  );
}

interface FormState {
  name: string;
  source: string;
  secret_name: string;
  filter: string;
  task_template: string;
}

const emptyForm: FormState = {
  name: '',
  source: 'generic',
  secret_name: '',
  filter: '',
  task_template: '',
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={handleCopy}
      title="Copy URL"
      style={{
        background: 'none',
        border: `1px solid ${colors.surface1}`,
        color: copied ? colors.green : colors.subtext0,
        cursor: 'pointer',
        borderRadius: '4px',
        padding: '1px 7px',
        fontSize: '11px',
        lineHeight: '1.6',
        transition: 'color 0.15s',
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function WebhookList() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);

  async function load() {
    try {
      const data = await fetchWebhooks();
      setWebhooks(Array.isArray(data) ? data : []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load webhooks');
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
      await createWebhook({
        name: form.name.trim(),
        source: form.source,
        secret_name: form.secret_name.trim() || undefined,
        filter: form.filter.trim() || undefined,
        task_template: form.task_template.trim() || undefined,
      });
      handleCancel();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create webhook');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this webhook?')) return;
    setDeleteLoading(id);
    try {
      await deleteWebhook(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete webhook');
    } finally {
      setDeleteLoading(null);
    }
  }

  // Derive the endpoint URL for a webhook's source
  function receiveUrl(source: string) {
    const base = window.location.hostname === 'localhost'
      ? 'http://localhost:9090'
      : window.location.origin;
    return `${base}/api/webhooks/receive/${source}`;
  }

  const canSave = form.name.trim().length > 0;

  return (
    <div style={{ ...baseStyles.card, marginBottom: '16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3
          style={{
            margin: 0,
            fontSize: '13px',
            fontWeight: '600',
            color: colors.subtext0,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Webhook Triggers
        </h3>
        <button
          onClick={handleNew}
          style={{ ...baseStyles.button.primary, fontSize: '12px', padding: '5px 12px' }}
        >
          + Add Webhook
        </button>
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
            padding: '14px',
            backgroundColor: colors.mantle,
            borderRadius: '6px',
            marginBottom: '12px',
            border: `1px solid ${colors.surface1}`,
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: '600', color: colors.text, marginBottom: '12px' }}>
            Add Webhook
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label style={{ display: 'block', color: colors.subtext1, fontSize: '12px', marginBottom: '4px' }}>
                Name *
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. GitHub Issues"
                style={baseStyles.input}
                autoFocus
              />
            </div>
            <div>
              <label style={{ display: 'block', color: colors.subtext1, fontSize: '12px', marginBottom: '4px' }}>
                Source
              </label>
              <select
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                style={{ ...baseStyles.input, cursor: 'pointer' }}
              >
                {SOURCE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label style={{ display: 'block', color: colors.subtext1, fontSize: '12px', marginBottom: '4px' }}>
                Secret Name
                <span style={{ color: colors.overlay0, fontWeight: 400, marginLeft: '4px' }}>
                  (vault key for HMAC verification)
                </span>
              </label>
              <input
                type="text"
                value={form.secret_name}
                onChange={(e) => setForm({ ...form, secret_name: e.target.value })}
                placeholder="e.g. github-webhook-secret"
                style={baseStyles.input}
              />
            </div>
            <div>
              <label style={{ display: 'block', color: colors.subtext1, fontSize: '12px', marginBottom: '4px' }}>
                Event Filter
                <span style={{ color: colors.overlay0, fontWeight: 400, marginLeft: '4px' }}>
                  (optional, e.g. issues.opened)
                </span>
              </label>
              <input
                type="text"
                value={form.filter}
                onChange={(e) => setForm({ ...form, filter: e.target.value })}
                placeholder="e.g. push, issues, pull_request.opened"
                style={baseStyles.input}
              />
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', color: colors.subtext1, fontSize: '12px', marginBottom: '4px' }}>
              Task Template
              <span style={{ color: colors.overlay0, fontWeight: 400, marginLeft: '4px' }}>
                (Go template — use title: / description: fields)
              </span>
            </label>
            <textarea
              value={form.task_template}
              onChange={(e) => setForm({ ...form, task_template: e.target.value })}
              placeholder={'title: Issue: {{.payload.issue.title}}\ndescription: Opened by {{.payload.sender.login}}'}
              rows={3}
              style={{
                ...baseStyles.input,
                height: 'auto',
                resize: 'vertical',
                fontFamily: 'monospace',
                fontSize: '12px',
              }}
            />
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
              {saving ? 'Saving...' : 'Add Webhook'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ color: colors.subtext0, fontSize: '14px' }}>Loading...</div>
      ) : webhooks.length === 0 && !showForm ? (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: colors.mantle,
            borderRadius: '6px',
            fontSize: '13px',
            color: colors.subtext0,
            lineHeight: '1.6',
          }}
        >
          No webhooks configured. Webhook triggers let external services (GitHub, Slack, or any HTTP
          client) automatically create tasks in Ratchet. Click "+ Add Webhook" to configure one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {webhooks.map((wh) => {
            const url = receiveUrl(wh.source);
            return (
              <div
                key={wh.id}
                style={{
                  padding: '12px 14px',
                  backgroundColor: colors.mantle,
                  borderRadius: '6px',
                  border: `1px solid transparent`,
                }}
              >
                {/* Top row: name + source badge */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        fontSize: '14px',
                        fontWeight: '500',
                        color: colors.text,
                      }}
                    >
                      {wh.name}
                    </span>
                    <SourceBadge source={wh.source} />
                    {wh.filter && (
                      <span
                        style={{
                          fontSize: '11px',
                          color: colors.blue,
                          backgroundColor: `${colors.blue}22`,
                          padding: '2px 8px',
                          borderRadius: '10px',
                          fontFamily: 'monospace',
                        }}
                      >
                        {wh.filter}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(wh.id)}
                    disabled={deleteLoading === wh.id}
                    style={{
                      backgroundColor: 'transparent',
                      color: colors.red,
                      border: `1px solid ${colors.red}44`,
                      borderRadius: '6px',
                      padding: '4px 10px',
                      fontSize: '11px',
                      cursor: 'pointer',
                      opacity: deleteLoading === wh.id ? 0.6 : 1,
                    }}
                  >
                    Delete
                  </button>
                </div>

                {/* Endpoint URL */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: wh.secret_name || wh.task_template ? '8px' : 0,
                  }}
                >
                  <span style={{ fontSize: '11px', color: colors.subtext0 }}>Endpoint:</span>
                  <code
                    style={{
                      fontSize: '12px',
                      color: colors.subtext1,
                      backgroundColor: colors.surface0,
                      padding: '2px 8px',
                      borderRadius: '4px',
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    POST {url}
                  </code>
                  <CopyButton text={url} />
                </div>

                {/* Details row */}
                {(wh.secret_name || wh.task_template) && (
                  <div
                    style={{
                      display: 'flex',
                      gap: '12px',
                      fontSize: '12px',
                      color: colors.subtext0,
                    }}
                  >
                    {wh.secret_name && (
                      <span>
                        Secret: <code style={{ color: colors.peach }}>{wh.secret_name}</code>
                      </span>
                    )}
                    {wh.task_template && (
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        Template: <code style={{ color: colors.green, fontFamily: 'monospace' }}>{wh.task_template.split('\n')[0]}</code>
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Docs hint */}
      {webhooks.length > 0 && (
        <div
          style={{
            marginTop: '12px',
            fontSize: '12px',
            color: colors.overlay0,
            lineHeight: '1.6',
          }}
        >
          Receive endpoints accept POST requests. GitHub/Slack signatures are verified automatically
          if a Secret Name is configured. Event filters use prefix matching (e.g. "issues" matches
          "issues.opened").
        </div>
      )}
    </div>
  );
}
