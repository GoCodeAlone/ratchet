import { useEffect, useState } from 'react';
import { colors, baseStyles } from '../theme';
import { apiGet } from '../utils/api';

interface ServerInfo {
  version: string;
  uptime: string;
  agent_count: number;
  team_count: number;
  plugins?: string[];
}

export default function Settings() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet<ServerInfo>('/info')
      .then((data) => setInfo(data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load server info'))
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
    <div style={{ maxWidth: '640px' }}>
      {/* Server Info */}
      <div style={{ ...baseStyles.card, marginBottom: '16px' }}>
        <SectionTitle>Server Info</SectionTitle>
        {loading ? (
          <div style={{ color: colors.subtext0, fontSize: '14px' }}>Loading...</div>
        ) : error ? (
          <div style={{ color: colors.red, fontSize: '14px' }}>{error}</div>
        ) : info ? (
          <>
            <InfoRow label="Version" value={info.version ?? 'Unknown'} />
            <InfoRow label="Uptime" value={info.uptime ?? 'Unknown'} />
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
      <div style={{ ...baseStyles.card, marginBottom: '16px' }}>
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

      {/* Connection */}
      <div style={{ ...baseStyles.card, marginBottom: '16px' }}>
        <SectionTitle>Connection</SectionTitle>
        <InfoRow label="API Base" value="localhost:9090" />
        <InfoRow label="UI Port" value="localhost:5173 (dev)" />
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
      <div style={{ ...baseStyles.card }}>
        <SectionTitle>MCP Servers</SectionTitle>
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
          MCP (Model Context Protocol) servers provide additional tools to agents. Configure them
          via <code style={{ color: colors.blue }}>ratchet.yaml</code> or the{' '}
          <code style={{ color: colors.blue }}>POST /api/mcp-servers</code> API endpoint.
        </div>
      </div>
    </div>
  );
}
