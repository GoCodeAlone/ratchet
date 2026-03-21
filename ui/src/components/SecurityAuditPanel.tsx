import { useState } from 'react';
import { colors, baseStyles } from '../theme';
import { apiPost } from '../utils/api';

interface AuditFinding {
  check: string;
  severity: string;
  status: string;
  evidence: string;
  remediation: string;
}

interface AuditResult {
  findings: AuditFinding[];
  score: number;
  passed: number;
  failed: number;
}

const severityColors: Record<string, string> = {
  critical: colors.red,
  high: colors.red,
  warning: colors.yellow,
  medium: colors.yellow,
  info: colors.blue,
  low: colors.blue,
  pass: colors.green,
};

function SeverityBadge({ severity }: { severity: string }) {
  const color = severityColors[severity.toLowerCase()] ?? colors.overlay1;
  return (
    <span
      style={{
        fontSize: '11px',
        color,
        backgroundColor: `${color}22`,
        padding: '2px 8px',
        borderRadius: '10px',
        textTransform: 'uppercase',
        fontWeight: '600',
        letterSpacing: '0.03em',
      }}
    >
      {severity}
    </span>
  );
}

function StatusIcon({ status }: { status: string }) {
  const pass = status.toLowerCase() === 'pass' || status.toLowerCase() === 'ok';
  return (
    <span
      style={{
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: pass ? colors.green : colors.red,
        flexShrink: 0,
      }}
    />
  );
}

export default function SecurityAuditPanel() {
  const [result, setResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  async function runAudit() {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await apiPost<AuditResult>('/security/audit', {});
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run security audit');
    } finally {
      setLoading(false);
    }
  }

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
          Security Audit
        </h3>
        <button
          onClick={runAudit}
          disabled={loading}
          style={{
            ...baseStyles.button.primary,
            fontSize: '12px',
            padding: '5px 12px',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Running...' : 'Run Audit'}
        </button>
      </div>

      {error && (
        <div
          style={{
            color: colors.red,
            fontSize: '13px',
            marginBottom: '12px',
            padding: '8px 12px',
            backgroundColor: `${colors.red}11`,
            borderRadius: '6px',
          }}
        >
          {error}
        </div>
      )}

      {!result && !loading && !error && (
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
          Run a security audit to check your Ratchet instance for common security issues including
          auth configuration, secret management, TLS, and access controls.
        </div>
      )}

      {loading && (
        <div style={{ color: colors.subtext0, fontSize: '14px', padding: '20px', textAlign: 'center' }}>
          Running security audit...
        </div>
      )}

      {result && (
        <>
          {/* Score summary */}
          <div
            style={{
              display: 'flex',
              gap: '16px',
              marginBottom: '16px',
              padding: '14px',
              backgroundColor: colors.mantle,
              borderRadius: '6px',
            }}
          >
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: '24px', fontWeight: '700', color: result.score >= 80 ? colors.green : result.score >= 50 ? colors.yellow : colors.red }}>
                {result.score}
              </div>
              <div style={{ fontSize: '11px', color: colors.subtext0, textTransform: 'uppercase' }}>Score</div>
            </div>
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: '24px', fontWeight: '700', color: colors.green }}>
                {result.passed}
              </div>
              <div style={{ fontSize: '11px', color: colors.subtext0, textTransform: 'uppercase' }}>Passed</div>
            </div>
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: '24px', fontWeight: '700', color: result.failed > 0 ? colors.red : colors.green }}>
                {result.failed}
              </div>
              <div style={{ fontSize: '11px', color: colors.subtext0, textTransform: 'uppercase' }}>Failed</div>
            </div>
          </div>

          {/* Findings list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {result.findings.map((finding, idx) => {
              const isExpanded = expandedIdx === idx;
              return (
                <div
                  key={idx}
                  style={{
                    padding: '10px 14px',
                    backgroundColor: colors.mantle,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    border: `1px solid transparent`,
                  }}
                  onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <StatusIcon status={finding.status} />
                    <span style={{ fontSize: '13px', color: colors.text, flex: 1 }}>
                      {finding.check}
                    </span>
                    <SeverityBadge severity={finding.severity} />
                  </div>
                  {isExpanded && (
                    <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${colors.surface1}` }}>
                      {finding.evidence && (
                        <div style={{ marginBottom: '8px' }}>
                          <div style={{ fontSize: '11px', color: colors.subtext0, textTransform: 'uppercase', marginBottom: '4px' }}>
                            Evidence
                          </div>
                          <div style={{ fontSize: '12px', color: colors.subtext1, fontFamily: 'monospace' }}>
                            {finding.evidence}
                          </div>
                        </div>
                      )}
                      {finding.remediation && (
                        <div>
                          <div style={{ fontSize: '11px', color: colors.subtext0, textTransform: 'uppercase', marginBottom: '4px' }}>
                            Remediation
                          </div>
                          <div style={{ fontSize: '12px', color: colors.subtext1, lineHeight: '1.5' }}>
                            {finding.remediation}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
