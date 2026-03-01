import { useEffect, useRef, useState } from 'react';
import { colors, baseStyles } from '../theme';
import type { MCPServer } from '../types';
import { fetchMcpServers, createMcpServer, updateMcpServer, deleteMcpServer, reloadMcpServers } from '../utils/api';

function StatusBadge({ status }: { status: string }) {
  const color = status === 'active' ? colors.green : colors.overlay0;
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

interface ArgsTagInputProps {
  args: string[];
  onChange: (args: string[]) => void;
}

function ArgsTagInput({ args, onChange }: ArgsTagInputProps) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function addArg() {
    const trimmed = inputValue.trim();
    if (trimmed.length === 0) return;
    onChange([...args, trimmed]);
    setInputValue('');
  }

  function removeArg(index: number) {
    onChange(args.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addArg();
    } else if (e.key === 'Backspace' && inputValue === '' && args.length > 0) {
      onChange(args.slice(0, -1));
    }
  }

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      style={{
        ...baseStyles.input,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '5px',
        minHeight: '38px',
        height: 'auto',
        padding: '5px 8px',
        cursor: 'text',
      }}
    >
      {args.map((arg, i) => (
        <span
          key={i}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            backgroundColor: colors.surface1,
            color: colors.text,
            borderRadius: '4px',
            padding: '2px 6px',
            fontSize: '12px',
            fontFamily: 'monospace',
            flexShrink: 0,
            maxWidth: '100%',
            wordBreak: 'break-all',
          }}
        >
          {arg}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); removeArg(i); }}
            style={{
              background: 'none',
              border: 'none',
              color: colors.subtext0,
              cursor: 'pointer',
              padding: '0',
              lineHeight: '1',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
            aria-label={`Remove argument ${arg}`}
          >
            ×
          </button>
        </span>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: '1 1 120px', minWidth: '80px' }}>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={args.length === 0 ? 'Type an argument and press Enter' : ''}
          data-1p-ignore
          style={{
            background: 'none',
            border: 'none',
            outline: 'none',
            color: colors.text,
            fontSize: '13px',
            fontFamily: 'monospace',
            flex: 1,
            minWidth: '60px',
            padding: '0',
          }}
        />
        {inputValue.trim().length > 0 && (
          <button
            type="button"
            onClick={addArg}
            style={{
              backgroundColor: colors.surface1,
              color: colors.subtext1,
              border: 'none',
              borderRadius: '4px',
              padding: '2px 7px',
              fontSize: '11px',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Add
          </button>
        )}
      </div>
    </div>
  );
}

function parseArgsJson(raw: string): string[] {
  if (!raw || raw.trim() === '') return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // not valid JSON — treat as a single argument if non-empty
    if (raw.trim()) return [raw.trim()];
  }
  return [];
}

function serializeArgsJson(args: string[]): string {
  if (args.length === 0) return '';
  return JSON.stringify(args);
}

interface FormState {
  name: string;
  command: string;
  argsList: string[];
  url: string;
  transport: 'stdio' | 'sse';
}

const emptyForm: FormState = { name: '', command: '', argsList: [], url: '', transport: 'stdio' };

export default function McpServerList() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reloadResult, setReloadResult] = useState<{ success: boolean; reloaded: number; errors?: string[] } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  async function load() {
    try {
      const data = await fetchMcpServers();
      setServers(Array.isArray(data) ? data : []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load MCP servers');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function handleEdit(server: MCPServer) {
    setEditId(server.id);
    setForm({
      name: server.name,
      command: server.command || '',
      argsList: parseArgsJson(server.args || ''),
      url: server.url || '',
      transport: server.transport || 'stdio',
    });
    setShowForm(true);
  }

  function handleNew() {
    setEditId(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  }

  function handleCancel() {
    setShowForm(false);
    setEditId(null);
    setForm({ ...emptyForm });
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    const argsJson = serializeArgsJson(form.argsList);
    try {
      if (editId) {
        await updateMcpServer(editId, {
          name: form.name,
          command: form.command,
          args: argsJson,
          url: form.url,
          transport: form.transport,
        });
      } else {
        await createMcpServer({
          name: form.name,
          command: form.command,
          args: argsJson || undefined,
          url: form.url || undefined,
          transport: form.transport,
        });
      }
      handleCancel();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this MCP server?')) return;
    setActionLoading(id);
    try {
      await deleteMcpServer(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReload() {
    setReloading(true);
    setReloadResult(null);
    try {
      const result = await reloadMcpServers();
      setReloadResult(result);
    } catch (err) {
      setReloadResult({ success: false, reloaded: 0, errors: [err instanceof Error ? err.message : 'Reload failed'] });
    } finally {
      setReloading(false);
    }
  }

  const canSave = form.name.trim().length > 0 && (form.transport === 'sse' ? form.url.trim().length > 0 : form.command.trim().length > 0);

  return (
    <div style={{ ...baseStyles.card, marginBottom: '16px' }}>
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
          MCP Servers
        </h3>
        <div style={{ display: 'flex', gap: '6px' }}>
          {servers.length > 0 && (
            <button
              onClick={handleReload}
              disabled={reloading}
              style={{
                ...baseStyles.button.secondary,
                fontSize: '12px',
                padding: '5px 12px',
                opacity: reloading ? 0.6 : 1,
              }}
            >
              {reloading ? 'Reloading...' : 'Reload All'}
            </button>
          )}
          <button
            onClick={handleNew}
            style={{ ...baseStyles.button.primary, fontSize: '12px', padding: '5px 12px' }}
          >
            + Add Server
          </button>
        </div>
      </div>

      {error && (
        <div style={{ color: colors.red, fontSize: '13px', marginBottom: '12px', padding: '8px 12px', backgroundColor: `${colors.red}11`, borderRadius: '6px' }}>
          {error}
        </div>
      )}

      {reloadResult && (
        <div style={{
          fontSize: '12px',
          marginBottom: '12px',
          padding: '8px 12px',
          borderRadius: '6px',
          backgroundColor: reloadResult.success ? `${colors.green}11` : `${colors.yellow}11`,
          color: reloadResult.success ? colors.green : colors.yellow,
        }}>
          {reloadResult.success
            ? `Reloaded ${reloadResult.reloaded} server${reloadResult.reloaded !== 1 ? 's' : ''} successfully.`
            : 'Reload completed with errors.'}
          {reloadResult.errors && reloadResult.errors.length > 0 && (
            <div style={{ marginTop: '4px', color: colors.red, fontSize: '11px' }}>
              {reloadResult.errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
        </div>
      )}

      {/* Inline form */}
      {showForm && (
        <div style={{
          padding: '14px',
          backgroundColor: colors.mantle,
          borderRadius: '6px',
          marginBottom: '12px',
          border: `1px solid ${colors.surface1}`,
        }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: colors.text, marginBottom: '12px' }}>
            {editId ? 'Edit Server' : 'Add MCP Server'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label style={{ display: 'block', color: colors.subtext1, fontSize: '12px', marginBottom: '4px' }}>Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. filesystem"
                data-1p-ignore
                style={baseStyles.input}
                autoFocus
              />
            </div>
            <div>
              <label style={{ display: 'block', color: colors.subtext1, fontSize: '12px', marginBottom: '4px' }}>Transport</label>
              <select
                value={form.transport}
                onChange={(e) => setForm({ ...form, transport: e.target.value as 'stdio' | 'sse' })}
                style={{ ...baseStyles.input, cursor: 'pointer' }}
              >
                <option value="stdio">stdio</option>
                <option value="sse">SSE</option>
              </select>
            </div>
          </div>
          {form.transport === 'stdio' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
              <div>
                <label style={{ display: 'block', color: colors.subtext1, fontSize: '12px', marginBottom: '4px' }}>Command *</label>
                <input
                  type="text"
                  value={form.command}
                  onChange={(e) => setForm({ ...form, command: e.target.value })}
                  placeholder="e.g. npx"
                  data-1p-ignore
                  style={baseStyles.input}
                />
              </div>
              <div>
                <label style={{ display: 'block', color: colors.subtext1, fontSize: '12px', marginBottom: '4px' }}>Args</label>
                <ArgsTagInput
                  args={form.argsList}
                  onChange={(argsList) => setForm({ ...form, argsList })}
                />
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', color: colors.subtext1, fontSize: '12px', marginBottom: '4px' }}>URL *</label>
              <input
                type="text"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="e.g. http://localhost:3001/sse"
                data-1p-ignore
                style={baseStyles.input}
              />
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button onClick={handleCancel} style={{ ...baseStyles.button.secondary, fontSize: '12px', padding: '6px 14px' }}>
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave || saving}
              style={{ ...baseStyles.button.primary, fontSize: '12px', padding: '6px 14px', opacity: canSave && !saving ? 1 : 0.6 }}
            >
              {saving ? 'Saving...' : editId ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* Server list */}
      {loading ? (
        <div style={{ color: colors.subtext0, fontSize: '14px' }}>Loading...</div>
      ) : servers.length === 0 && !showForm ? (
        <div style={{
          padding: '10px 14px',
          backgroundColor: colors.mantle,
          borderRadius: '6px',
          fontSize: '13px',
          color: colors.subtext0,
          lineHeight: '1.6',
        }}>
          No MCP servers configured. MCP servers provide additional tools to agents — file access,
          database queries, web search, and more. Click "+ Add Server" to connect one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {servers.map((server) => (
            <div
              key={server.id}
              style={{
                padding: '12px 14px',
                backgroundColor: colors.mantle,
                borderRadius: '6px',
                border: `1px solid transparent`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '500', color: colors.text, fontFamily: 'monospace' }}>
                    {server.name}
                  </span>
                  <span style={{
                    fontSize: '11px',
                    color: colors.subtext0,
                    backgroundColor: colors.surface0,
                    padding: '1px 8px',
                    borderRadius: '10px',
                  }}>
                    {server.transport || 'stdio'}
                  </span>
                </div>
                <StatusBadge status={server.status || 'active'} />
              </div>
              <div style={{ fontSize: '12px', color: colors.subtext0, marginBottom: '8px', fontFamily: 'monospace' }}>
                {server.command && <span>{server.command} {server.args || ''}</span>}
                {server.url && !server.command && <span>{server.url}</span>}
                {!server.command && !server.url && <span style={{ color: colors.overlay0 }}>No command configured</span>}
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={() => handleEdit(server)}
                  style={{ ...baseStyles.button.secondary, padding: '4px 10px', fontSize: '11px' }}
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(server.id)}
                  disabled={actionLoading === server.id}
                  style={{
                    backgroundColor: 'transparent',
                    color: colors.red,
                    border: `1px solid ${colors.red}44`,
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '11px',
                    cursor: 'pointer',
                    opacity: actionLoading === server.id ? 0.6 : 1,
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
