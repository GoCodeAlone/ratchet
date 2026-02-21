import { useEffect, useState } from 'react';
import { colors, baseStyles } from '../theme';
import {
  fetchVaultStatus,
  testVaultConnection,
  configureVault,
  resetVault,
  type VaultStatus,
  type VaultResult,
} from '../utils/api';

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

function StatusBadge({ backend }: { backend: string }) {
  const color =
    backend === 'vault-remote'
      ? colors.green
      : backend === 'vault-dev'
        ? colors.blue
        : colors.yellow;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: '600',
        backgroundColor: `${color}22`,
        color,
        border: `1px solid ${color}44`,
      }}
    >
      {backend}
    </span>
  );
}

export default function VaultSettings() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Form state
  const [address, setAddress] = useState('');
  const [token, setToken] = useState('');
  const [mountPath, setMountPath] = useState('secret');
  const [namespace, setNamespace] = useState('');
  const [migrateSecrets, setMigrateSecrets] = useState(false);

  // Action state
  const [testResult, setTestResult] = useState<VaultResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [actionMessage, setActionMessage] = useState('');

  const loadStatus = () => {
    setLoading(true);
    fetchVaultStatus()
      .then((data) => {
        setStatus(data);
        if (data.address) setAddress(data.address);
        if (data.mount_path) setMountPath(data.mount_path);
        if (data.namespace) setNamespace(data.namespace);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load vault status'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setActionMessage('');
    try {
      const result = await testVaultConnection({
        address,
        token,
        mount_path: mountPath,
        namespace: namespace || undefined,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({
        success: false,
        error: err instanceof Error ? err.message : 'Test failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleConfigure = async () => {
    setConfiguring(true);
    setActionMessage('');
    setTestResult(null);
    try {
      const result = await configureVault({
        address,
        token,
        mount_path: mountPath,
        namespace: namespace || undefined,
        migrate_secrets: migrateSecrets ? 'true' : undefined,
      });
      if (result.success) {
        setActionMessage(result.message || 'Configured successfully');
        setToken('');
        loadStatus();
      } else {
        setActionMessage(result.error || 'Configuration failed');
      }
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Configuration failed');
    } finally {
      setConfiguring(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    setActionMessage('');
    setTestResult(null);
    try {
      const result = await resetVault();
      if (result.success) {
        setActionMessage(result.message || 'Reset to vault-dev');
        setAddress('');
        setToken('');
        setMountPath('secret');
        setNamespace('');
        loadStatus();
      } else {
        setActionMessage(result.error || 'Reset failed');
      }
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setResetting(false);
    }
  };

  const inputStyle = {
    ...baseStyles.input,
    marginBottom: '10px',
  };

  return (
    <div style={{ ...baseStyles.card, marginBottom: '16px' }}>
      <SectionTitle>Vault Settings</SectionTitle>

      {/* Current Status */}
      {loading ? (
        <div style={{ color: colors.subtext0, fontSize: '14px' }}>Loading...</div>
      ) : error ? (
        <div style={{ color: colors.red, fontSize: '14px' }}>{error}</div>
      ) : status ? (
        <div style={{ marginBottom: '16px' }}>
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
            <span style={{ color: colors.subtext0 }}>Backend</span>
            <StatusBadge backend={status.backend} />
          </div>
          {status.address && (
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
              <span style={{ color: colors.subtext0 }}>Address</span>
              <span style={{ color: colors.text, fontFamily: 'monospace', fontSize: '13px' }}>
                {status.address}
              </span>
            </div>
          )}
          {status.mount_path && (
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
              <span style={{ color: colors.subtext0 }}>Mount Path</span>
              <span style={{ color: colors.text, fontFamily: 'monospace', fontSize: '13px' }}>
                {status.mount_path}
              </span>
            </div>
          )}
          {status.namespace && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 0',
                fontSize: '14px',
              }}
            >
              <span style={{ color: colors.subtext0 }}>Namespace</span>
              <span style={{ color: colors.text, fontFamily: 'monospace', fontSize: '13px' }}>
                {status.namespace}
              </span>
            </div>
          )}
        </div>
      ) : null}

      {/* Remote Vault Configuration */}
      <div
        style={{
          padding: '14px',
          backgroundColor: colors.mantle,
          borderRadius: '6px',
          marginBottom: '12px',
        }}
      >
        <div
          style={{
            fontSize: '13px',
            fontWeight: '600',
            color: colors.subtext0,
            marginBottom: '12px',
          }}
        >
          Remote Vault Configuration
        </div>

        <input
          type="text"
          placeholder="Vault Address (e.g. https://vault.example.com:8200)"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Vault Token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          style={inputStyle}
        />
        <input
          type="text"
          placeholder="Mount Path (default: secret)"
          value={mountPath}
          onChange={(e) => setMountPath(e.target.value)}
          style={inputStyle}
        />
        <input
          type="text"
          placeholder="Namespace (optional)"
          value={namespace}
          onChange={(e) => setNamespace(e.target.value)}
          style={inputStyle}
        />

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            color: colors.subtext0,
            marginBottom: '12px',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={migrateSecrets}
            onChange={(e) => setMigrateSecrets(e.target.checked)}
            style={{ accentColor: colors.blue }}
          />
          Migrate existing secrets when switching backends
        </label>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleTest}
            disabled={testing || !address || !token}
            style={{
              ...baseStyles.button.secondary,
              opacity: testing || !address || !token ? 0.5 : 1,
            }}
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          <button
            onClick={handleConfigure}
            disabled={configuring || !address || !token}
            style={{
              ...baseStyles.button.primary,
              opacity: configuring || !address || !token ? 0.5 : 1,
            }}
          >
            {configuring ? 'Saving...' : 'Save & Connect'}
          </button>
        </div>

        {/* Test result */}
        {testResult && (
          <div
            style={{
              marginTop: '10px',
              padding: '8px 12px',
              borderRadius: '6px',
              fontSize: '13px',
              backgroundColor: testResult.success ? `${colors.green}15` : `${colors.red}15`,
              color: testResult.success ? colors.green : colors.red,
              border: `1px solid ${testResult.success ? colors.green : colors.red}33`,
            }}
          >
            {testResult.success
              ? testResult.message || 'Connection successful'
              : testResult.error || 'Connection failed'}
          </div>
        )}
      </div>

      {/* Action message */}
      {actionMessage && (
        <div
          style={{
            marginBottom: '12px',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '13px',
            backgroundColor: `${colors.blue}15`,
            color: colors.blue,
            border: `1px solid ${colors.blue}33`,
          }}
        >
          {actionMessage}
        </div>
      )}

      {/* Reset */}
      {status && status.backend !== 'vault-dev' && (
        <button
          onClick={handleReset}
          disabled={resetting}
          style={{
            ...baseStyles.button.danger,
            opacity: resetting ? 0.5 : 1,
            fontSize: '13px',
            padding: '6px 14px',
          }}
        >
          {resetting ? 'Resetting...' : 'Reset to Vault-Dev'}
        </button>
      )}
    </div>
  );
}
