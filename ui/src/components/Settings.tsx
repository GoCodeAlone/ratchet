import { useEffect, useState } from 'react';
import { colors, baseStyles } from '../theme';
import { apiGet } from '../utils/api';
import ProviderList from './ProviderList';
import VaultSettings from './VaultSettings';
import McpServerList from './McpServerList';
import WebhookList from './WebhookList';

interface ServerInfo {
  version: string;
  uptime: string;
  started_at?: string;
  start_time?: string;
  agent_count: number;
  team_count: number;
  plugins?: string[];
}

function formatUptime(info: ServerInfo): string {
  const startRaw = info.started_at ?? info.start_time;
  if (startRaw) {
    const startMs = new Date(startRaw).getTime();
    if (!isNaN(startMs)) {
      const totalSeconds = Math.floor((Date.now() - startMs) / 1000);
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      if (days > 0) return `${days}d ${hours}h`;
      if (hours > 0) return `${hours}h ${minutes}m`;
      return `${minutes}m`;
    }
  }
  return info.uptime ?? 'running';
}

export default function Settings() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet<ServerInfo>('/info')
      .then((data: ServerInfo) => setInfo(data))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load server info'))
      .finally(() => setLoading(false));
  }, []);

  function SectionTitle({ children }: { children: string }) {
    return (
      <h3
        style={{
          margin: '0 0 16px',
          fontSize: '13px',
          fontWeight: '600',
          color: colors.subtext0,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {children}
      </h3>
    );
  }

  function InfoRow({ label, value }: { label: string; value: string | number }) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 0',
          borderBottom: `1px solid ${colors.surface1}`,
          fontSize: '14px',
        }}
      >
        <span style={{ color: colors.subtext0 }}>{label}</span>
        <span style={{ color: colors.text, fontFamily: 'monospace', fontSize: '13px' }}>
          {value}
        </span>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '640px', paddingBottom: '32px' }}>
      {/* Section anchor nav */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap',
          marginBottom: '20px',
          padding: '10px 14px',
          backgroundColor: colors.mantle,
          borderRadius: '8px',
          fontSize: '13px',
        }}
      >
        {[
          ['server-info', 'Server Info'],
          ['plugins', 'Plugins'],
          ['vault', 'Vault'],
          ['ai-providers', 'AI Providers'],
          ['connection', 'Connection'],
          ['mcp', 'MCP Servers'],
          ['webhooks', 'Webhooks'],
        ].map(([id, label]) => (
          <a
            key={id}
            href={`#settings-${id}`}
            style={{ color: colors.blue, textDecoration: 'none', padding: '2px 8px', borderRadius: '4px', backgroundColor: `${colors.blue}11` }}
          >
            {label}
          </a>
        ))}
      </div>
      {/* Server Info */}
      <div id="settings-server-info" style={{ ...baseStyles.card, marginBottom: '16px' }}>
        <SectionTitle>Server Info</SectionTitle>
        {loading ? (
          <div style={{ color: colors.subtext0, fontSize: '14px' }}>Loading...</div>
        ) : error ? (
          <div style={{ color: colors.red, fontSize: '14px' }}>{error}</div>
        ) : info ? (
          <>
            <InfoRow label="Version" value={info.version ?? 'Unknown'} />
            <InfoRow label="Uptime" value={formatUptime(info)} />
            <InfoRow label="Agents" value={info.agent_count ?? 0} />
            <InfoRow label="Teams" value={info.team_count ?? 0} />
          </>
        ) : (
          <div style={{ color: colors.overlay0, fontSize: '14px' }}>
            Server info not available. Make sure the Ratchet server is running at localhost:9090.
          </div>
        )}
      </div>

      {/* Plugins */}
      <div id="settings-plugins" style={{ ...baseStyles.card, marginBottom: '16px' }}>
        <SectionTitle>Plugins</SectionTitle>
        {info?.plugins && info.plugins.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {info.plugins.map((plugin) => (
              <div
                key={plugin}
                style={{
                  padding: '8px 12px',
                  backgroundColor: colors.mantle,
                  borderRadius: '6px',
                  fontSize: '13px',
                  color: colors.text,
                  fontFamily: 'monospace',
                }}
              >
                {plugin}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: colors.overlay0, fontSize: '14px' }}>
            No plugins loaded.
          </div>
        )}
      </div>

      {/* Vault Settings */}
      <div id="settings-vault" />
      <VaultSettings />

      {/* AI Providers */}
      <div id="settings-ai-providers" />
      <ProviderList />

      {/* Connection */}
      <div id="settings-connection" style={{ ...baseStyles.card, marginBottom: '16px' }}>
        <SectionTitle>Connection</SectionTitle>
        <InfoRow label="API Base" value="localhost:9090" />
        <InfoRow label="UI Host" value={window.location.host} />
        <div
          style={{
            marginTop: '12px',
            padding: '10px 14px',
            backgroundColor: colors.mantle,
            borderRadius: '6px',
            fontSize: '13px',
            color: colors.subtext0,
            lineHeight: '1.6',
          }}
        >
          API requests are proxied to the Ratchet server. SSE events stream from{' '}
          <code style={{ color: colors.blue }}>/events</code>. Auth token is stored in{' '}
          <code style={{ color: colors.blue }}>localStorage</code>.
        </div>
      </div>

      {/* MCP Servers */}
      <div id="settings-mcp" />
      <McpServerList />

      {/* Webhooks */}
      <div id="settings-webhooks" />
      <WebhookList />
    </div>
  );
}
