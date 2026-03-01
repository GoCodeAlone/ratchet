import { useState, useEffect } from 'react';
import { useRequestStore } from '../store/requestStore';
import { colors, baseStyles } from '../theme';
import type { HumanRequest, RequestType } from '../types';

// ---------------------------------------------------------------------------
// Color maps
// ---------------------------------------------------------------------------

const requestTypeColors: Record<string, string> = {
  token: colors.yellow,
  binary: colors.blue,
  access: colors.mauve,
  info: colors.teal,
  custom: colors.peach,
};

const urgencyColors: Record<string, string> = {
  critical: colors.red,
  high: colors.peach,
  normal: colors.blue,
  low: colors.overlay0,
};

const requestStatusColors: Record<string, string> = {
  pending: colors.yellow,
  resolved: colors.green,
  cancelled: colors.overlay0,
  expired: colors.red,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return '';
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'just now';
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
}

function parseMetadata(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TypeBadge({ type }: { type: RequestType }) {
  const color = requestTypeColors[type] ?? colors.overlay1;
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
        letterSpacing: '0.02em',
      }}
    >
      {type}
    </span>
  );
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const color = urgencyColors[urgency] ?? colors.overlay0;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '11px',
        color,
        backgroundColor: `${color}22`,
        padding: '2px 8px',
        borderRadius: '10px',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        fontWeight: '600',
      }}
    >
      <span
        style={{
          width: '5px',
          height: '5px',
          borderRadius: '50%',
          backgroundColor: color,
          display: 'inline-block',
        }}
      />
      {urgency}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = requestStatusColors[status] ?? colors.overlay0;
  return (
    <span
      style={{
        fontSize: '12px',
        color,
        backgroundColor: `${color}22`,
        padding: '2px 10px',
        borderRadius: '10px',
        textTransform: 'capitalize',
      }}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Per-request local form state
// ---------------------------------------------------------------------------

interface FormState {
  responseValue: string;
  comment: string;
  submitting: boolean;
  cancelling: boolean;
  error: string;
}

function emptyForm(): FormState {
  return { responseValue: '', comment: '', submitting: false, cancelling: false, error: '' };
}

// ---------------------------------------------------------------------------
// Resolution form (shown for pending requests)
// ---------------------------------------------------------------------------

function ResolutionForm({
  request,
  metadata,
  onResolve,
  onCancel,
}: {
  request: HumanRequest;
  metadata: Record<string, unknown> | null;
  onResolve: (responseValue: unknown, comment: string) => Promise<void>;
  onCancel: (comment: string) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(emptyForm());

  function update(patch: Partial<FormState>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function handleResolve() {
    update({ submitting: true, error: '' });
    try {
      // For token requests, wrap as {value: ...} so backend autoStoreSecret can extract it
      const data = request.request_type === 'token'
        ? { value: form.responseValue }
        : form.responseValue;
      await onResolve(data, form.comment);
    } catch (err) {
      update({ error: err instanceof Error ? err.message : 'Failed to resolve' });
    } finally {
      update({ submitting: false });
    }
  }

  async function handleCancel() {
    if (!confirm('Cancel this request? The agent will be notified.')) return;
    update({ cancelling: true, error: '' });
    try {
      await onCancel(form.comment);
    } catch (err) {
      update({ error: err instanceof Error ? err.message : 'Failed to cancel' });
    } finally {
      update({ cancelling: false });
    }
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    color: colors.subtext1,
    fontSize: '12px',
    marginBottom: '5px',
  };

  const secretName = (typeof metadata?.secret_name === 'string' ? metadata.secret_name : null)
    ?? (typeof metadata?.secret === 'string' ? metadata.secret : null);

  return (
    <div
      style={{
        marginTop: '14px',
        paddingTop: '14px',
        borderTop: `1px solid ${colors.surface1}`,
      }}
    >
      {form.error && (
        <div
          style={{
            color: colors.red,
            fontSize: '12px',
            marginBottom: '10px',
            padding: '6px 10px',
            backgroundColor: `${colors.red}11`,
            borderRadius: '6px',
          }}
        >
          {form.error}
        </div>
      )}

      {/* Response input — varies by request type */}
      <div style={{ marginBottom: '10px' }}>
        {request.request_type === 'token' && (
          <>
            <label style={labelStyle}>Secret value</label>
            <input
              type="password"
              value={form.responseValue}
              onChange={(e) => update({ responseValue: e.target.value })}
              placeholder="Paste token or secret..."
              autoComplete="off"
              data-1p-ignore
              style={baseStyles.input}
            />
            {secretName && (
              <div
                style={{
                  fontSize: '11px',
                  color: colors.subtext0,
                  marginTop: '5px',
                }}
              >
                Will be stored as:{' '}
                <code
                  style={{
                    color: colors.yellow,
                    backgroundColor: `${colors.yellow}15`,
                    padding: '1px 5px',
                    borderRadius: '3px',
                    fontFamily: 'monospace',
                  }}
                >
                  {secretName}
                </code>
              </div>
            )}
          </>
        )}

        {request.request_type === 'binary' && (
          <>
            <label style={labelStyle}>What was installed / path</label>
            <input
              type="text"
              value={form.responseValue}
              onChange={(e) => update({ responseValue: e.target.value })}
              placeholder="e.g. /usr/local/bin/mytool or 'installed via brew'"
              data-1p-ignore
              style={baseStyles.input}
            />
          </>
        )}

        {request.request_type === 'access' && (
          <>
            <label style={labelStyle}>Access details</label>
            <input
              type="text"
              value={form.responseValue}
              onChange={(e) => update({ responseValue: e.target.value })}
              placeholder="e.g. granted, role assigned, credentials configured"
              data-1p-ignore
              style={baseStyles.input}
            />
          </>
        )}

        {(request.request_type === 'info' || request.request_type === 'custom') && (
          <>
            <label style={labelStyle}>Your response</label>
            <textarea
              value={form.responseValue}
              onChange={(e) => update({ responseValue: e.target.value })}
              placeholder="Type your answer..."
              rows={3}
              style={{ ...baseStyles.input, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </>
        )}
      </div>

      {/* Comment (always shown) */}
      <div style={{ marginBottom: '12px' }}>
        <label style={labelStyle}>Comment (optional)</label>
        <input
          type="text"
          value={form.comment}
          onChange={(e) => update({ comment: e.target.value })}
          placeholder="Add a note for the agent..."
          data-1p-ignore
          style={baseStyles.input}
        />
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={handleResolve}
          disabled={form.submitting || form.cancelling}
          style={{
            ...baseStyles.button.primary,
            fontSize: '12px',
            padding: '6px 16px',
            opacity: form.submitting || form.cancelling ? 0.6 : 1,
          }}
        >
          {form.submitting ? 'Resolving...' : 'Resolve'}
        </button>
        <button
          onClick={handleCancel}
          disabled={form.submitting || form.cancelling}
          style={{
            ...baseStyles.button.danger,
            fontSize: '12px',
            padding: '6px 14px',
            opacity: form.submitting || form.cancelling ? 0.6 : 1,
          }}
        >
          {form.cancelling ? 'Cancelling...' : 'Cancel Request'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resolution info (shown for resolved / cancelled / expired requests)
// ---------------------------------------------------------------------------

function ResolutionInfo({ request }: { request: HumanRequest }) {
  const statusColor = requestStatusColors[request.status] ?? colors.overlay0;

  // For token requests, never display response_data (it may contain secrets).
  // Instead show a confirmation that the value was stored.
  const isToken = request.request_type === 'token';

  let parsedResponse: unknown = null;
  if (!isToken && request.response_data) {
    try {
      parsedResponse = JSON.parse(request.response_data);
    } catch {
      parsedResponse = request.response_data;
    }
  }

  const responseDisplay = isToken
    ? null
    : parsedResponse !== null
      ? typeof parsedResponse === 'string'
        ? parsedResponse
        : JSON.stringify(parsedResponse, null, 2)
      : null;

  // Extract secret_name from metadata for token requests
  const metadata = parseMetadata(request.metadata);
  const secretName = isToken
    ? (typeof metadata?.secret_name === 'string' ? metadata.secret_name : null)
      ?? (typeof metadata?.secret === 'string' ? metadata.secret : null)
    : null;

  return (
    <div
      style={{
        marginTop: '12px',
        paddingTop: '12px',
        borderTop: `1px solid ${colors.surface1}`,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <StatusBadge status={request.status} />
        {request.resolved_at && (
          <span style={{ fontSize: '11px', color: colors.overlay0 }}>
            {timeAgo(request.resolved_at)}
          </span>
        )}
      </div>

      {isToken && request.status === 'resolved' && (
        <div
          style={{
            fontSize: '12px',
            color: colors.green,
            backgroundColor: `${colors.green}15`,
            padding: '6px 10px',
            borderRadius: '6px',
            fontFamily: 'monospace',
          }}
        >
          Secret stored{secretName ? ` as ${secretName}` : ''}
        </div>
      )}

      {responseDisplay && (
        <div>
          <div
            style={{
              fontSize: '11px',
              color: colors.subtext0,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: '4px',
              fontWeight: '600',
            }}
          >
            Response
          </div>
          <pre
            style={{
              margin: 0,
              padding: '8px 10px',
              backgroundColor: colors.mantle,
              borderRadius: '6px',
              fontSize: '12px',
              color: statusColor,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'monospace',
              border: `1px solid ${statusColor}22`,
            }}
          >
            {responseDisplay}
          </pre>
        </div>
      )}

      {(request.response_comment || request.resolved_by) && (
        <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: colors.subtext0 }}>
          {request.response_comment && (
            <span>
              Note:{' '}
              <span style={{ color: colors.subtext1, fontStyle: 'italic' }}>
                {request.response_comment}
              </span>
            </span>
          )}
          {request.resolved_by && (
            <span>
              By:{' '}
              <span
                style={{
                  color: colors.mauve,
                  fontFamily: 'monospace',
                  fontSize: '11px',
                }}
              >
                {request.resolved_by}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single request card
// ---------------------------------------------------------------------------

function RequestCard({
  request,
  onResolve,
  onCancel,
}: {
  request: HumanRequest;
  onResolve: (id: string, responseValue: unknown, comment: string) => Promise<void>;
  onCancel: (id: string, comment: string) => Promise<void>;
}) {
  const isPending = request.status === 'pending';
  const metadata = parseMetadata(request.metadata);
  const typeColor = requestTypeColors[request.request_type] ?? colors.overlay1;

  return (
    <div
      style={{
        ...baseStyles.card,
        borderLeft: `3px solid ${typeColor}`,
        padding: '16px 18px',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px',
          flexWrap: 'wrap',
          marginBottom: '10px',
        }}
      >
        <UrgencyBadge urgency={request.urgency} />
        <TypeBadge type={request.request_type} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: '14px',
            fontWeight: '500',
            color: colors.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={request.title}
        >
          {request.title}
        </span>
        <span
          style={{
            fontSize: '11px',
            color: colors.overlay0,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {timeAgo(request.created_at)}
        </span>
      </div>

      {/* Description */}
      {request.description && (
        <p
          style={{
            margin: '0 0 10px',
            fontSize: '13px',
            color: colors.subtext0,
            lineHeight: '1.5',
          }}
        >
          {request.description}
        </p>
      )}

      {/* Agent / Task info row */}
      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '12px', color: colors.subtext0, marginBottom: metadata ? '10px' : '0' }}>
        {request.agent_id && (
          <span>
            Agent:{' '}
            <span style={{ color: colors.blue, fontFamily: 'monospace' }}>
              {request.agent_id}
            </span>
          </span>
        )}
        {request.task_id && (
          <span>
            Task:{' '}
            <span style={{ color: colors.teal, fontFamily: 'monospace' }}>
              {request.task_id}
            </span>
          </span>
        )}
        {request.timeout_minutes > 0 && (
          <span style={{ color: colors.overlay0 }}>
            Timeout: {request.timeout_minutes}m
          </span>
        )}
      </div>

      {/* Metadata key-value pairs */}
      {metadata && Object.keys(metadata).length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
            marginTop: '8px',
          }}
        >
          {Object.entries(metadata).map(([key, value]) => (
            <span
              key={key}
              style={{
                fontSize: '11px',
                backgroundColor: colors.mantle,
                borderRadius: '4px',
                padding: '2px 8px',
                color: colors.subtext0,
                border: `1px solid ${colors.surface1}`,
              }}
            >
              <span style={{ color: colors.overlay1 }}>{key}:</span>{' '}
              <span
                style={{
                  color: colors.subtext1,
                  fontFamily: 'monospace',
                  maxWidth: '200px',
                  display: 'inline-block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  verticalAlign: 'bottom',
                  whiteSpace: 'nowrap',
                }}
                title={String(value)}
              >
                {String(value)}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Pending: resolution form */}
      {isPending && (
        <ResolutionForm
          request={request}
          metadata={metadata}
          onResolve={(rv, comment) => onResolve(request.id, rv, comment)}
          onCancel={(comment) => onCancel(request.id, comment)}
        />
      )}

      {/* Resolved / cancelled / expired: resolution info */}
      {!isPending && <ResolutionInfo request={request} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function RequestList() {
  const {
    requests,
    loading,
    error,
    showAll,
    fetchRequests,
    setShowAll,
    resolveRequest,
    cancelRequest,
    subscribeSSE,
    unsubscribeSSE,
  } = useRequestStore();

  useEffect(() => {
    fetchRequests();
    subscribeSSE();
    return () => {
      unsubscribeSSE();
    };
  }, [fetchRequests, subscribeSSE, unsubscribeSSE]);

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  if (loading && requests.length === 0) {
    return (
      <div style={{ color: colors.subtext0, padding: '40px', textAlign: 'center' }}>
        Loading requests...
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
    <div style={{ maxWidth: '900px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: colors.subtext0, fontSize: '14px' }}>
            {showAll
              ? `${requests.length} request${requests.length !== 1 ? 's' : ''} total`
              : `${pendingCount} pending request${pendingCount !== 1 ? 's' : ''}`}
          </span>
          {pendingCount > 0 && !showAll && (
            <span
              style={{
                fontSize: '11px',
                color: colors.yellow,
                backgroundColor: `${colors.yellow}22`,
                padding: '2px 8px',
                borderRadius: '10px',
                fontWeight: '600',
              }}
            >
              Action required
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => fetchRequests()}
            style={{ ...baseStyles.button.secondary, fontSize: '13px', padding: '6px 12px' }}
          >
            Refresh
          </button>
          <button
            onClick={() => setShowAll(!showAll)}
            style={{ ...baseStyles.button.secondary, fontSize: '13px', padding: '6px 14px' }}
          >
            {showAll ? 'Show Pending' : 'Show All'}
          </button>
        </div>
      </div>

      {/* Request cards */}
      {requests.length === 0 ? (
        <div
          style={{
            ...baseStyles.card,
            textAlign: 'center',
            padding: '60px',
            color: colors.overlay0,
          }}
        >
          {showAll
            ? 'No requests found.'
            : 'No pending requests. Agents are working independently.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {requests.map((request: HumanRequest) => (
            <RequestCard
              key={request.id}
              request={request}
              onResolve={resolveRequest}
              onCancel={cancelRequest}
            />
          ))}
        </div>
      )}
    </div>
  );
}
