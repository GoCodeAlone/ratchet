import { useEffect, useState } from 'react';
import { colors, baseStyles } from '../theme';
import { useProviderStore } from '../store/providerStore';
import { LLMProvider, ProviderStatus, ProviderTestResult } from '../types';
import ProviderWizard from './ProviderWizard';

function ProviderStatusBadge({ status }: { status: ProviderStatus }) {
  const colorMap: Record<ProviderStatus, string> = {
    unchecked: colors.overlay0,
    active: colors.green,
    error: colors.red,
  };
  const color = colorMap[status] ?? colors.overlay0;
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

export default function ProviderList() {
  const { providers, loading, error, fetchProviders, removeProvider, testProvider, setDefault } = useProviderStore();
  const [showWizard, setShowWizard] = useState(false);
  const [editProvider, setEditProvider] = useState<LLMProvider | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ProviderTestResult>>({});

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  async function handleTest(alias: string) {
    setActionLoading(alias + '-test');
    try {
      const result = await testProvider(alias);
      setTestResults((prev) => ({ ...prev, [alias]: result }));
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [alias]: { success: false, message: err instanceof Error ? err.message : 'Test failed' } }));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(alias: string) {
    if (!confirm(`Delete provider "${alias}"?`)) return;
    setActionLoading(alias + '-delete');
    try {
      await removeProvider(alias);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSetDefault(alias: string) {
    setActionLoading(alias + '-default');
    try {
      await setDefault(alias);
    } finally {
      setActionLoading(null);
    }
  }

  function handleEdit(provider: LLMProvider) {
    setEditProvider(provider);
  }

  function SectionTitle({ children, action }: { children: string; action?: React.ReactNode }) {
    return (
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
          {children}
        </h3>
        {action}
      </div>
    );
  }

  return (
    <div style={{ ...baseStyles.card, marginBottom: '16px' }}>
      <SectionTitle
        action={
          <button
            onClick={() => setShowWizard(true)}
            style={{ ...baseStyles.button.primary, fontSize: '12px', padding: '5px 12px' }}
          >
            + Add Provider
          </button>
        }
      >
        AI Providers
      </SectionTitle>

      {loading && providers.length === 0 ? (
        <div style={{ color: colors.subtext0, fontSize: '14px' }}>Loading...</div>
      ) : error ? (
        <div style={{ color: colors.red, fontSize: '14px' }}>{error}</div>
      ) : providers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 24px' }}>
          <div style={{ fontSize: '15px', fontWeight: '600', color: colors.text, marginBottom: '8px' }}>
            Connect an AI provider to get started
          </div>
          <div style={{ fontSize: '13px', color: colors.subtext0, marginBottom: '20px', lineHeight: '1.6' }}>
            Ratchet agents need an AI provider to think and act. Add your Anthropic or OpenAI
            API key, or use the built-in mock provider for testing.
          </div>
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '16px',
            marginBottom: '20px',
            fontSize: '12px',
          }}>
            <a href="https://console.anthropic.com/settings/keys"
               target="_blank" rel="noopener noreferrer"
               style={{ color: colors.peach, textDecoration: 'none' }}>
              Get Anthropic key
            </a>
            <span style={{ color: colors.surface2 }}>|</span>
            <a href="https://platform.openai.com/api-keys"
               target="_blank" rel="noopener noreferrer"
               style={{ color: colors.green, textDecoration: 'none' }}>
              Get OpenAI key
            </a>
          </div>
          <button
            onClick={() => setShowWizard(true)}
            style={{ ...baseStyles.button.primary, fontSize: '13px' }}
          >
            + Add Your First Provider
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {providers.map((provider) => (
            <div
              key={provider.alias}
              style={{
                padding: '12px 14px',
                backgroundColor: colors.mantle,
                borderRadius: '6px',
                border: provider.is_default ? `1px solid ${colors.blue}44` : `1px solid transparent`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '500', color: colors.text, fontFamily: 'monospace' }}>
                    {provider.alias}
                  </span>
                  <span style={{
                    fontSize: '11px',
                    color: colors.subtext0,
                    backgroundColor: colors.surface0,
                    padding: '1px 8px',
                    borderRadius: '10px',
                  }}>
                    {provider.type}
                  </span>
                  {!!provider.is_default && (
                    <span style={{
                      fontSize: '11px',
                      color: colors.blue,
                      backgroundColor: `${colors.blue}22`,
                      padding: '1px 8px',
                      borderRadius: '10px',
                    }}>
                      default
                    </span>
                  )}
                </div>
                <ProviderStatusBadge status={provider.status} />
              </div>
              <div style={{ fontSize: '12px', color: colors.subtext0, marginBottom: '10px', fontFamily: 'monospace' }}>
                {provider.model}
              </div>
              {testResults[provider.alias] && (
                <div style={{ fontSize: '12px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{
                    display: 'inline-block',
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: testResults[provider.alias].success ? colors.green : colors.red,
                  }} />
                  <span style={{ color: testResults[provider.alias].success ? colors.green : colors.red }}>
                    {testResults[provider.alias].message}
                  </span>
                  {testResults[provider.alias].latency_ms !== undefined && (
                    <span style={{ color: colors.overlay0, fontSize: '11px' }}>
                      ({testResults[provider.alias].latency_ms}ms)
                    </span>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={() => handleTest(provider.alias)}
                  disabled={actionLoading === provider.alias + '-test'}
                  style={{
                    ...baseStyles.button.secondary,
                    padding: '4px 10px',
                    fontSize: '11px',
                    opacity: actionLoading === provider.alias + '-test' ? 0.6 : 1,
                  }}
                >
                  {actionLoading === provider.alias + '-test' ? 'Testing...' : 'Test'}
                </button>
                <button
                  onClick={() => handleEdit(provider)}
                  style={{ ...baseStyles.button.secondary, padding: '4px 10px', fontSize: '11px' }}
                >
                  Edit
                </button>
                {!provider.is_default && (
                  <button
                    onClick={() => handleSetDefault(provider.alias)}
                    disabled={actionLoading === provider.alias + '-default'}
                    style={{
                      ...baseStyles.button.secondary,
                      padding: '4px 10px',
                      fontSize: '11px',
                      opacity: actionLoading === provider.alias + '-default' ? 0.6 : 1,
                    }}
                  >
                    Set Default
                  </button>
                )}
                <button
                  onClick={() => handleDelete(provider.alias)}
                  disabled={actionLoading === provider.alias + '-delete'}
                  style={{
                    backgroundColor: 'transparent',
                    color: colors.red,
                    border: `1px solid ${colors.red}44`,
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '11px',
                    cursor: 'pointer',
                    opacity: actionLoading === provider.alias + '-delete' ? 0.6 : 1,
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showWizard && <ProviderWizard onClose={() => setShowWizard(false)} />}
      {editProvider && (
        <ProviderWizard
          onClose={() => setEditProvider(null)}
          editAlias={editProvider.alias}
          editType={editProvider.type}
          editModel={editProvider.model}
          editBaseUrl={editProvider.base_url}
        />
      )}
    </div>
  );
}
