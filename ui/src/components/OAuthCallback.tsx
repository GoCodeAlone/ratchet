import { useEffect, useState } from 'react';
import { colors } from '../theme';

export default function OAuthCallback() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Completing authorization...');

  useEffect(() => {
    handleCallback();
  }, []);

  async function handleCallback() {
    const pathname = window.location.pathname; // e.g., /oauth/openrouter
    const provider = pathname.split('/').pop() || '';
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (!code) {
      setStatus('error');
      setMessage('No authorization code received.');
      return;
    }

    const verifier = sessionStorage.getItem('oauth_code_verifier');

    try {
      let apiKey = '';

      if (provider === 'openrouter') {
        // Client-side exchange with OpenRouter
        const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            code_verifier: verifier || undefined,
            code_challenge_method: verifier ? 'S256' : undefined,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`OpenRouter error: ${text}`);
        }
        const data = await res.json();
        apiKey = data.key;
      } else {
        throw new Error(`Unknown provider: ${provider}`);
      }

      // Store result for the opener window to read
      sessionStorage.setItem('oauth_result', JSON.stringify({ success: true, api_key: apiKey }));
      setStatus('success');
      setMessage('Connected! This window will close...');

      // Auto-close after a brief moment
      setTimeout(() => window.close(), 1500);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Authorization failed';
      sessionStorage.setItem('oauth_result', JSON.stringify({ success: false, error: errorMsg }));
      setStatus('error');
      setMessage(errorMsg);
    }
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: colors.base,
      color: colors.text,
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <div style={{
        textAlign: 'center',
        padding: '40px',
        backgroundColor: colors.surface0,
        borderRadius: '12px',
        border: `1px solid ${colors.surface1}`,
        maxWidth: '400px',
      }}>
        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          margin: '0 auto 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '24px',
          backgroundColor: status === 'success' ? `${colors.green}22` : status === 'error' ? `${colors.red}22` : `${colors.blue}22`,
          color: status === 'success' ? colors.green : status === 'error' ? colors.red : colors.blue,
        }}>
          {status === 'loading' ? '...' : status === 'success' ? '\u2713' : '\u2717'}
        </div>
        <div style={{ fontSize: '14px', color: colors.text, marginBottom: '8px', fontWeight: '500' }}>
          {status === 'loading' ? 'Processing...' : status === 'success' ? 'Success' : 'Error'}
        </div>
        <div style={{ fontSize: '13px', color: colors.subtext0 }}>
          {message}
        </div>
        {status === 'error' && (
          <button
            onClick={() => window.close()}
            style={{
              marginTop: '16px',
              padding: '8px 16px',
              backgroundColor: colors.surface1,
              color: colors.text,
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
