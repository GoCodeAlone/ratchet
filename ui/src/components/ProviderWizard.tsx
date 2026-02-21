import { useState } from 'react';
import { colors, baseStyles } from '../theme';
import { ProviderType, ProviderTestResult } from '../types';
import { useProviderStore } from '../store/providerStore';
import { storeSecret, testProvider as testProviderApi } from '../utils/api';

interface ProviderWizardProps {
  onClose: () => void;
  editAlias?: string;
  editType?: ProviderType;
  editModel?: string;
  editBaseUrl?: string;
}

const PROVIDER_TYPES: { type: ProviderType; label: string; description: string }[] = [
  { type: 'anthropic', label: 'Anthropic', description: 'Claude models via Anthropic API' },
  { type: 'openai', label: 'OpenAI', description: 'GPT models via OpenAI API' },
  { type: 'copilot', label: 'Copilot', description: 'GitHub Copilot integration' },
  { type: 'mock', label: 'Custom', description: 'Custom provider with base URL' },
];

const MODEL_OPTIONS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-opus-4-0520', 'claude-3-5-haiku-20241022'],
  openai: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  copilot: ['copilot-default'],
  mock: [],
};

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: '4px',
            borderRadius: '2px',
            backgroundColor: i <= current ? colors.blue : colors.surface1,
            transition: 'background-color 0.2s',
          }}
        />
      ))}
    </div>
  );
}

export default function ProviderWizard({ onClose, editAlias, editType, editModel, editBaseUrl }: ProviderWizardProps) {
  const isEdit = !!editAlias;
  const [step, setStep] = useState(isEdit ? 1 : 0);
  const [providerType, setProviderType] = useState<ProviderType>(editType ?? 'anthropic');
  const [alias, setAlias] = useState(editAlias ?? '');
  const [baseUrl, setBaseUrl] = useState(editBaseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(editModel ?? '');
  const [customModel, setCustomModel] = useState('');
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { addProvider } = useProviderStore();

  const stepTitles = ['Choose Type', 'Alias & Config', 'API Key & Model', 'Test & Confirm'];

  function handleTypeSelect(type: ProviderType) {
    setProviderType(type);
    if (!alias || alias === suggestAlias(providerType)) {
      setAlias(suggestAlias(type));
    }
    const models = MODEL_OPTIONS[type];
    if (models && models.length > 0) {
      setModel(models[0]);
    } else {
      setModel('');
    }
  }

  function suggestAlias(type: ProviderType): string {
    const suggestions: Record<ProviderType, string> = {
      anthropic: 'claude-main',
      openai: 'openai-main',
      copilot: 'copilot-main',
      mock: 'custom-provider',
    };
    return suggestions[type];
  }

  function canNext(): boolean {
    switch (step) {
      case 0: return true;
      case 1: return alias.trim().length > 0;
      case 2: return (model.trim().length > 0 || customModel.trim().length > 0) && (providerType === 'mock' || providerType === 'copilot' || apiKey.trim().length > 0);
      case 3: return true;
      default: return false;
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const secretName = `provider_${alias.replace(/[^a-zA-Z0-9_-]/g, '_')}_key`;
      if (apiKey.trim()) {
        await storeSecret(secretName, apiKey.trim());
      }
      const result = await testProviderApi(alias);
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const secretName = `provider_${alias.replace(/[^a-zA-Z0-9_-]/g, '_')}_key`;
      if (apiKey.trim()) {
        await storeSecret(secretName, apiKey.trim());
      }
      const finalModel = customModel.trim() || model;
      await addProvider({
        alias: alias.trim(),
        type: providerType,
        model: finalModel,
        api_base_url: baseUrl.trim(),
        secret_name: secretName,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save provider');
    } finally {
      setSaving(false);
    }
  }

  const models = MODEL_OPTIONS[providerType] ?? [];
  const finalModel = customModel.trim() || model;

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ ...baseStyles.card, width: '520px', padding: '28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h3 style={{ margin: 0, color: colors.text, fontSize: '16px' }}>
            {isEdit ? 'Edit Provider' : 'Add AI Provider'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: colors.overlay0, cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>&times;</button>
        </div>
        <div style={{ fontSize: '12px', color: colors.subtext0, marginBottom: '16px' }}>
          Step {step + 1} of 4: {stepTitles[step]}
        </div>

        <StepIndicator current={step} total={4} />

        {error && (
          <div style={{ color: colors.red, fontSize: '13px', marginBottom: '12px', padding: '8px 12px', backgroundColor: `${colors.red}11`, borderRadius: '6px' }}>
            {error}
          </div>
        )}

        {/* Step 0: Choose Type */}
        {step === 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {PROVIDER_TYPES.map(({ type, label, description }) => (
              <button
                key={type}
                onClick={() => handleTypeSelect(type)}
                style={{
                  ...baseStyles.card,
                  cursor: 'pointer',
                  textAlign: 'left',
                  border: providerType === type ? `2px solid ${colors.blue}` : `1px solid ${colors.surface1}`,
                  backgroundColor: providerType === type ? `${colors.blue}11` : colors.surface0,
                  padding: '16px',
                }}
              >
                <div style={{ fontSize: '14px', fontWeight: '600', color: colors.text, marginBottom: '6px' }}>
                  {label}
                </div>
                <div style={{ fontSize: '12px', color: colors.subtext0 }}>
                  {description}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Step 1: Alias & Config */}
        {step === 1 && (
          <div>
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', color: colors.subtext1, fontSize: '13px', marginBottom: '6px' }}>Alias *</label>
              <input
                type="text"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="e.g. claude-main"
                autoFocus
                style={baseStyles.input}
              />
              <div style={{ fontSize: '11px', color: colors.overlay0, marginTop: '4px' }}>
                Unique identifier for this provider configuration
              </div>
            </div>
            {providerType === 'mock' && (
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', color: colors.subtext1, fontSize: '13px', marginBottom: '6px' }}>Base URL</label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com/v1"
                  style={baseStyles.input}
                />
              </div>
            )}
          </div>
        )}

        {/* Step 2: API Key & Model */}
        {step === 2 && (
          <div>
            {providerType !== 'mock' && providerType !== 'copilot' && (
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', color: colors.subtext1, fontSize: '13px', marginBottom: '6px' }}>API Key *</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    autoFocus
                    style={{ ...baseStyles.input, paddingRight: '60px' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: colors.overlay1,
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <div style={{ fontSize: '11px', color: colors.overlay0, marginTop: '4px' }}>
                  Stored securely as a secret. Never sent to the UI.
                </div>
              </div>
            )}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', color: colors.subtext1, fontSize: '13px', marginBottom: '6px' }}>Model *</label>
              {models.length > 0 ? (
                <select
                  value={model}
                  onChange={(e) => { setModel(e.target.value); setCustomModel(''); }}
                  style={{ ...baseStyles.input, cursor: 'pointer' }}
                >
                  {models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value="">Custom...</option>
                </select>
              ) : null}
              {(models.length === 0 || model === '') && (
                <input
                  type="text"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder="Model name"
                  style={{ ...baseStyles.input, marginTop: models.length > 0 ? '8px' : 0 }}
                />
              )}
            </div>
          </div>
        )}

        {/* Step 3: Test & Confirm */}
        {step === 3 && (
          <div>
            <div style={{ ...baseStyles.card, backgroundColor: colors.mantle, marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: colors.subtext0, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
                Summary
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '13px' }}>
                <div>
                  <div style={{ color: colors.subtext0, marginBottom: '2px' }}>Type</div>
                  <div style={{ color: colors.text }}>{providerType}</div>
                </div>
                <div>
                  <div style={{ color: colors.subtext0, marginBottom: '2px' }}>Alias</div>
                  <div style={{ color: colors.text, fontFamily: 'monospace' }}>{alias}</div>
                </div>
                <div>
                  <div style={{ color: colors.subtext0, marginBottom: '2px' }}>Model</div>
                  <div style={{ color: colors.text, fontFamily: 'monospace' }}>{finalModel || '(none)'}</div>
                </div>
                <div>
                  <div style={{ color: colors.subtext0, marginBottom: '2px' }}>API Key</div>
                  <div style={{ color: colors.text }}>{apiKey ? 'Provided' : 'Not set'}</div>
                </div>
                {baseUrl && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ color: colors.subtext0, marginBottom: '2px' }}>Base URL</div>
                    <div style={{ color: colors.text, fontFamily: 'monospace', fontSize: '12px' }}>{baseUrl}</div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <button
                onClick={handleTest}
                disabled={testing}
                style={{ ...baseStyles.button.secondary, opacity: testing ? 0.6 : 1 }}
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              {testResult && (
                <div style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: testResult.success ? colors.green : colors.red,
                  }} />
                  <span style={{ color: testResult.success ? colors.green : colors.red }}>
                    {testResult.message}
                  </span>
                  {testResult.latency_ms !== undefined && (
                    <span style={{ color: colors.overlay0, fontSize: '11px' }}>
                      ({testResult.latency_ms}ms)
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer buttons */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '24px' }}>
          <div>
            {step > 0 && !isEdit && (
              <button onClick={() => { setStep(step - 1); setError(''); }} style={baseStyles.button.secondary}>
                Back
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={onClose} style={baseStyles.button.secondary}>Cancel</button>
            {step < 3 ? (
              <button
                onClick={() => { setStep(step + 1); setError(''); }}
                disabled={!canNext()}
                style={{ ...baseStyles.button.primary, opacity: canNext() ? 1 : 0.6 }}
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ ...baseStyles.button.primary, opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Saving...' : 'Save Provider'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
