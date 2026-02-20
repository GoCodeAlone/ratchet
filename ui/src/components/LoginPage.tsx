import { useState, FormEvent } from 'react';
import { useAuthStore } from '../store/authStore';
import { colors, baseStyles } from '../theme';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, error } = useAuthStore();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await login(username, password);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        ...baseStyles.container,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: '360px',
          padding: '40px',
          backgroundColor: colors.surface0,
          borderRadius: '12px',
          border: `1px solid ${colors.surface1}`,
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h1
            style={{
              fontSize: '28px',
              fontWeight: '700',
              color: colors.blue,
              margin: '0 0 8px',
              letterSpacing: '-0.5px',
            }}
          >
            Ratchet
          </h1>
          <p style={{ color: colors.subtext0, fontSize: '14px', margin: 0 }}>
            AI Agent Mission Control
          </p>
        </div>

        {error && (
          <div
            style={{
              backgroundColor: `${colors.red}22`,
              border: `1px solid ${colors.red}`,
              borderRadius: '6px',
              padding: '10px 14px',
              color: colors.red,
              fontSize: '14px',
              marginBottom: '20px',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label
              style={{
                display: 'block',
                color: colors.subtext1,
                fontSize: '13px',
                fontWeight: '500',
                marginBottom: '6px',
              }}
            >
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoFocus
              required
              style={baseStyles.input}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label
              style={{
                display: 'block',
                color: colors.subtext1,
                fontSize: '13px',
                fontWeight: '500',
                marginBottom: '6px',
              }}
            >
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={baseStyles.input}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              ...baseStyles.button.primary,
              width: '100%',
              padding: '10px',
              fontSize: '15px',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
