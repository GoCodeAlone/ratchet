import { useState } from 'react';
import { colors, baseStyles } from '../theme';
import { ProviderType, ProviderTestResult } from '../types';
import { useProviderStore } from '../store/providerStore';
import { storeSecret, testProvider as testProviderApi, updateProvider, listProviderModels, ModelInfo } from '../utils/api';
import { generateCodeVerifier, createCodeChallenge } from '../utils/pkce';

interface ProviderWizardProps {
  onClose: () => void;
  editAlias?: string;
  editType?: ProviderType;
  editModel?: string;
  editBaseUrl?: string;
}

const PROVIDER_TYPES: { type: ProviderType; label: string; description: string; setupNote: string }[] = [
  { type: 'anthropic', label: 'Anthropic', description: 'Claude models via Anthropic API', setupNote: 'Requires API key from console.anthropic.com' },
  { type: 'openai', label: 'OpenAI', description: 'GPT models via OpenAI API', setupNote: 'Requires API key from platform.openai.com' },
  { type: 'copilot', label: 'Copilot', description: 'GitHub Copilot integration', setupNote: 'Requires GitHub Copilot subscription + gh CLI' },
  { type: 'mock', label: 'Mock / Custom', description: 'For testing or custom OpenAI-compatible endpoints', setupNote: 'No API key needed' },
  { type: 'openrouter', label: 'OpenRouter', description: 'One key for 300+ models (Claude, GPT, Gemini)', setupNote: 'Free OAuth signup — no API key to copy' },
];

const MODEL_OPTIONS: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-opus-4-0520', 'claude-3-5-haiku-20241022'],
  openai: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  copilot: ['copilot-default'],
  mock: [],
  openrouter: ['anthropic/claude-sonnet-4', 'openai/gpt-4o', 'google/gemini-2.0-flash'],
};

const MODEL_DESCRIPTIONS: Record<string, string> = {
  'claude-sonnet-4-20250514': 'Balanced speed and capability. Recommended for most tasks.',
  'claude-opus-4-0520': 'Most capable. Best for complex reasoning. Slower and costlier.',
  'claude-3-5-haiku-20241022': 'Fastest and cheapest. Good for simple tasks.',
  'gpt-4o': 'Recommended. Fast multimodal model.',
  'gpt-4-turbo': 'Previous generation. Still capable.',
  'gpt-3.5-turbo': 'Cheapest. Best for simple tasks.',
  'copilot-default': 'Uses your GitHub Copilot subscription model.',
  'anthropic/claude-sonnet-4': 'Claude Sonnet via OpenRouter. Balanced speed and capability.',
  'openai/gpt-4o': 'GPT-4o via OpenRouter. Fast multimodal model.',
  'google/gemini-2.0-flash': 'Gemini Flash via OpenRouter. Fast and efficient.',
};

const PROVIDER_CONTEXT: Record<ProviderType, string> = {
  anthropic: 'You are setting up Anthropic (Claude). You will need an API key from your Anthropic console.',
  openai: 'You are setting up OpenAI (GPT). You will need an API key from the OpenAI platform.',
  copilot: 'You are setting up GitHub Copilot. Make sure the gh CLI is installed and authenticated.',
  mock: 'Mock provider returns scripted responses — useful for testing workflows without spending API credits.',
  openrouter: 'OpenRouter provides access to 300+ AI models through a single API key. Click "Connect" to set up your account via OAuth — no API key to copy.',
};

const infoBoxStyle = {
  padding: '10px 12px',
  backgroundColor: colors.mantle,
  borderRadius: '6px',
  marginBottom: '14px',
  fontSize: '12px',
  lineHeight: '1.6' as const,
  borderLeft: `3px solid ${colors.blue}`,
};

const linkStyle = (color: string) => ({ color, textDecoration: 'none' as const });

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

function TroubleshootingHint({ message, providerType }: { message: string; providerType: ProviderType }) {
  const msg = message.toLowerCase();

  let content: React.ReactNode;
  if (msg.includes('401') || msg.includes('authentication') || msg.includes('invalid')) {
    content = (
      <>
        Your API key appears to be invalid or expired.
        {providerType === 'anthropic' && (
          <> Check your key at{' '}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer"
             style={linkStyle(colors.peach)}>console.anthropic.com</a>.
          Make sure it starts with <code style={{ color: colors.blue }}>sk-ant-api03-</code>.</>
        )}
        {providerType === 'openai' && (
          <> Verify at{' '}
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer"
             style={linkStyle(colors.green)}>platform.openai.com</a>.
          Make sure it starts with <code style={{ color: colors.blue }}>sk-</code>.</>
        )}
      </>
    );
  } else if (msg.includes('429') || msg.includes('rate')) {
    content = 'Rate limit hit. Wait a moment and try again. Check your API plan for usage limits.';
  } else if (msg.includes('not yet implemented') || msg.includes('not implemented')) {
    content = 'This provider type is not fully implemented yet. You can still save the configuration. Use Anthropic or Mock for now.';
  } else if (msg.includes('secret') || msg.includes('resolve')) {
    content = 'Could not retrieve the stored API key. Go back to step 3 and re-enter your key.';
  } else if (msg.includes('network') || msg.includes('timeout') || msg.includes('connection')) {
    content = 'Network error. Check that you can reach the API endpoint and that no firewall is blocking the request.';
  } else {
    content = 'Go back and verify your API key and model selection. If the problem persists, try the mock provider to confirm your Ratchet server is working.';
  }

  return (
    <div style={{
      marginTop: '10px',
      padding: '10px 12px',
      backgroundColor: `${colors.yellow}10`,
      borderRadius: '6px',
      border: `1px solid ${colors.yellow}33`,
      fontSize: '12px',
      color: colors.subtext0,
      lineHeight: '1.6',
    }}>
      <div style={{ fontWeight: '600', color: colors.yellow, marginBottom: '4px' }}>
        Troubleshooting
      </div>
      <div>{content}</div>
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
  const [dynamicModels, setDynamicModels] = useState<ModelInfo[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState('');
  const [oauthPending, setOauthPending] = useState(false);
  const [savedDuringTest, setSavedDuringTest] = useState(false);

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
    setDynamicModels([]);
    setModelFetchError('');
  }

  function suggestAlias(type: ProviderType): string {
    const suggestions: Record<ProviderType, string> = {
      anthropic: 'claude-main',
      openai: 'openai-main',
      copilot: 'copilot-main',
      mock: 'custom-provider',
      openrouter: 'openrouter-main',
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

  async function handleFetchModels() {
    setFetchingModels(true);
    setModelFetchError('');
    try {
      const result = await listProviderModels(providerType, apiKey.trim(), baseUrl.trim());
      if (result.success && result.models && result.models.length > 0) {
        setDynamicModels(result.models);
        // Auto-select first model if none selected
        if (!model && !customModel) {
          setModel(result.models[0].id);
        }
      } else {
        setModelFetchError(result.error || 'No models returned');
      }
    } catch (err) {
      setModelFetchError(err instanceof Error ? err.message : 'Failed to fetch models');
    } finally {
      setFetchingModels(false);
    }
  }

  async function startOAuthFlow() {
    setOauthPending(true);
    setError('');

    try {
      const verifier = generateCodeVerifier();
      const challenge = await createCodeChallenge(verifier);
      sessionStorage.setItem('oauth_code_verifier', verifier);
      sessionStorage.removeItem('oauth_result');

      const callbackUrl = `${window.location.origin}/oauth/openrouter`;
      const authUrl = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callbackUrl)}&code_challenge=${challenge}&code_challenge_method=S256`;

      // Open popup
      const popup = window.open(authUrl, 'oauth', 'width=600,height=700,menubar=no,toolbar=no');

      // Poll for result
      const poll = setInterval(() => {
        if (popup?.closed) {
          clearInterval(poll);
          const result = sessionStorage.getItem('oauth_result');
          sessionStorage.removeItem('oauth_result');
          sessionStorage.removeItem('oauth_code_verifier');

          if (result) {
            try {
              const parsed = JSON.parse(result);
              if (parsed.success && parsed.api_key) {
                setApiKey(parsed.api_key);
                setError('');
              } else {
                setError(parsed.error || 'OAuth authorization failed');
              }
            } catch {
              setError('Failed to parse OAuth result');
            }
          }
          setOauthPending(false);
        }
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start OAuth flow');
      setOauthPending(false);
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
      const finalModel = customModel.trim() || model;
      // Save provider first so the test endpoint can find it
      if (!savedDuringTest && !isEdit) {
        await addProvider({
          alias: alias.trim(),
          type: providerType,
          model: finalModel,
          base_url: baseUrl.trim(),
          secret_name: secretName,
        });
        setSavedDuringTest(true);
      } else {
        await updateProvider(alias.trim(), {
          type: providerType,
          model: finalModel,
          base_url: baseUrl.trim(),
          secret_name: secretName,
        });
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
      if (savedDuringTest || isEdit) {
        await updateProvider(alias.trim(), {
          type: providerType,
          model: finalModel,
          base_url: baseUrl.trim(),
          secret_name: secretName,
        });
      } else {
        await addProvider({
          alias: alias.trim(),
          type: providerType,
          model: finalModel,
          base_url: baseUrl.trim(),
          secret_name: secretName,
        });
      }
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
            {PROVIDER_TYPES.map(({ type, label, description, setupNote }) => (
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
                <div style={{ fontSize: '11px', color: colors.overlay0, marginTop: '4px' }}>
                  {setupNote}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Step 1: Alias & Config */}
        {step === 1 && (
          <div>
            <div style={{ ...infoBoxStyle, color: colors.subtext0 }}>
              {PROVIDER_CONTEXT[providerType]}
            </div>
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
                A short name to reference this provider. Agents are assigned to providers by alias.
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
                <div style={{ fontSize: '11px', color: colors.overlay0, marginTop: '4px' }}>
                  Point to any OpenAI-compatible API (e.g. Ollama, LM Studio, vLLM). Leave blank for mock mode.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2: API Key & Model */}
        {step === 2 && (
          <div>
            {providerType === 'anthropic' && (
              <div style={{ ...infoBoxStyle, color: colors.subtext0 }}>
                <div style={{ color: colors.subtext1, marginBottom: '6px' }}>To get your Anthropic API key:</div>
                1. Go to{' '}
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer"
                   style={linkStyle(colors.peach)}>console.anthropic.com/settings/keys</a><br />
                2. Click "Create Key" and copy it<br />
                3. Key starts with <code style={{ color: colors.blue, fontSize: '11px' }}>sk-ant-api03-...</code>
              </div>
            )}
            {providerType === 'openai' && (
              <div style={{ ...infoBoxStyle, color: colors.subtext0 }}>
                <div style={{ color: colors.subtext1, marginBottom: '6px' }}>To get your OpenAI API key:</div>
                1. Go to{' '}
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer"
                   style={linkStyle(colors.green)}>platform.openai.com/api-keys</a><br />
                2. Click "Create new secret key" and copy it<br />
                3. Key starts with <code style={{ color: colors.blue, fontSize: '11px' }}>sk-...</code>
              </div>
            )}
            {providerType === 'copilot' && (
              <div style={{ ...infoBoxStyle, color: colors.subtext0 }}>
                <div style={{ color: colors.subtext1, marginBottom: '6px' }}>Copilot setup requirements:</div>
                1. Active GitHub Copilot subscription<br />
                2. GitHub CLI installed:{' '}
                <a href="https://cli.github.com" target="_blank" rel="noopener noreferrer"
                   style={linkStyle(colors.blue)}>cli.github.com</a><br />
                3. Authenticated via <code style={{ color: colors.blue, fontSize: '11px' }}>gh auth login</code>
              </div>
            )}
            {providerType === 'mock' && (
              <div style={{ ...infoBoxStyle, color: colors.subtext0 }}>
                No API key required. The mock provider returns scripted responses for testing.
                {baseUrl && ' Your custom endpoint will be called instead.'}
              </div>
            )}
            {providerType === 'openrouter' && (
              <div style={{ ...infoBoxStyle, color: colors.subtext0 }}>
                <div style={{ color: colors.subtext1, marginBottom: '6px' }}>OpenRouter — one key for 300+ models</div>
                Click the button below to connect your OpenRouter account. If you don't have one, you'll be prompted to create a free account.
              </div>
            )}
            {providerType === 'openrouter' && (
              <div style={{ marginBottom: '14px' }}>
                <button
                  type="button"
                  onClick={() => startOAuthFlow()}
                  disabled={oauthPending}
                  style={{
                    ...baseStyles.button.primary,
                    width: '100%',
                    padding: '12px 16px',
                    fontSize: '14px',
                    opacity: oauthPending ? 0.6 : 1,
                  }}
                >
                  {oauthPending ? 'Waiting for authorization...' : apiKey ? 'Reconnect with OpenRouter' : 'Connect with OpenRouter'}
                </button>
                {apiKey && (
                  <div style={{ fontSize: '12px', color: colors.green, marginTop: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: colors.green }} />
                    Connected — API key received
                  </div>
                )}
              </div>
            )}

            {providerType !== 'mock' && providerType !== 'copilot' && providerType !== 'openrouter' && (
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

              {/* Dynamic model fetch button */}
              {(providerType === 'anthropic' || providerType === 'openai') && apiKey.trim() && (
                <div style={{ marginBottom: '8px' }}>
                  <button
                    type="button"
                    onClick={handleFetchModels}
                    disabled={fetchingModels}
                    style={{
                      ...baseStyles.button.secondary,
                      fontSize: '12px',
                      padding: '5px 12px',
                      opacity: fetchingModels ? 0.6 : 1,
                    }}
                  >
                    {fetchingModels ? 'Fetching models...' : dynamicModels.length > 0 ? 'Refresh Models' : 'Fetch Available Models'}
                  </button>
                  {modelFetchError && (
                    <span style={{ fontSize: '11px', color: colors.red, marginLeft: '10px' }}>
                      {modelFetchError}
                    </span>
                  )}
                </div>
              )}

              {/* Dynamic model selector (from API) */}
              {dynamicModels.length > 0 ? (
                <select
                  value={model}
                  onChange={(e) => { setModel(e.target.value); setCustomModel(''); }}
                  style={{ ...baseStyles.input, cursor: 'pointer' }}
                >
                  {dynamicModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.id}{m.context_window ? ` (${Math.round(m.context_window / 1000)}k ctx)` : ''}
                    </option>
                  ))}
                  <option value="">Custom...</option>
                </select>
              ) : models.length > 0 ? (
                /* Fallback: static model list */
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
              {((models.length === 0 && dynamicModels.length === 0) || model === '') && (
                <input
                  type="text"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder="Model name"
                  style={{ ...baseStyles.input, marginTop: (models.length > 0 || dynamicModels.length > 0) ? '8px' : 0 }}
                />
              )}
              {model && MODEL_DESCRIPTIONS[model] && (
                <div style={{ fontSize: '11px', color: colors.overlay0, marginTop: '4px' }}>
                  {MODEL_DESCRIPTIONS[model]}
                </div>
              )}
              {dynamicModels.length > 0 && (
                <div style={{ fontSize: '11px', color: colors.teal, marginTop: '4px' }}>
                  {dynamicModels.length} models loaded from your {providerType} account
                </div>
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

            <div style={{ fontSize: '12px', color: colors.subtext0, marginBottom: '12px' }}>
              Test sends a simple "Hello" message to verify your API key and network connectivity.
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
            {testResult && !testResult.success && (
              <TroubleshootingHint message={testResult.message} providerType={providerType} />
            )}
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
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexDirection: 'column' }}>
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
            {step === 3 && testResult && !testResult.success && (
              <div style={{ fontSize: '11px', color: colors.overlay0 }}>
                You can save without a passing test and fix the configuration later.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
