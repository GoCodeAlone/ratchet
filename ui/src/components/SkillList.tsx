import { useEffect, useState } from 'react';
import { colors, baseStyles } from '../theme';
import { Skill } from '../types';
import { fetchSkills } from '../utils/api';

const categoryColors: Record<string, string> = {
  development: colors.blue,
  analysis: colors.teal,
  communication: colors.mauve,
  testing: colors.green,
  security: colors.red,
};

function categoryColor(cat: string): string {
  return categoryColors[cat] ?? colors.overlay1;
}

function CategoryBadge({ category }: { category: string }) {
  const color = categoryColor(category);
  return (
    <span
      style={{
        fontSize: '11px',
        color,
        backgroundColor: `${color}22`,
        padding: '2px 8px',
        borderRadius: '10px',
        textTransform: 'capitalize',
      }}
    >
      {category || 'general'}
    </span>
  );
}

function RequiredTools({ tools }: { tools: string }) {
  let parsed: string[] = [];
  try {
    parsed = JSON.parse(tools);
  } catch {
    // ignore
  }
  if (!parsed.length) return <span style={{ color: colors.overlay0, fontSize: '12px' }}>—</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
      {parsed.map((t) => (
        <span
          key={t}
          style={{
            fontSize: '11px',
            color: colors.peach,
            backgroundColor: `${colors.peach}22`,
            padding: '1px 6px',
            borderRadius: '4px',
            fontFamily: 'monospace',
          }}
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function SkillDetailModal({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{ ...baseStyles.card, width: '640px', maxHeight: '80vh', overflowY: 'auto', padding: '28px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: '0 0 6px', color: colors.text, fontSize: '18px' }}>{skill.name}</h3>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <CategoryBadge category={skill.category} />
              {skill.description && (
                <span style={{ fontSize: '13px', color: colors.subtext0 }}>{skill.description}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: colors.overlay0, cursor: 'pointer', fontSize: '20px', lineHeight: 1 }}
          >
            &times;
          </button>
        </div>

        {skill.required_tools && skill.required_tools !== '[]' && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', color: colors.subtext0, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Required Tools
            </div>
            <RequiredTools tools={skill.required_tools} />
          </div>
        )}

        <div style={{ borderTop: `1px solid ${colors.surface1}`, paddingTop: '16px' }}>
          <div style={{ fontSize: '12px', color: colors.subtext0, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Skill Content
          </div>
          <pre
            style={{
              margin: 0,
              fontSize: '13px',
              color: colors.subtext1,
              backgroundColor: colors.mantle,
              padding: '16px',
              borderRadius: '6px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: "'Inter', system-ui, sans-serif",
              lineHeight: '1.6',
            }}
          >
            {skill.content}
          </pre>
        </div>
      </div>
    </div>
  );
}

export default function SkillList() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Skill | null>(null);
  const [filter, setFilter] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchSkills();
      setSkills(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load skills');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = filter
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(filter.toLowerCase()) ||
          s.category.toLowerCase().includes(filter.toLowerCase()) ||
          s.description.toLowerCase().includes(filter.toLowerCase()),
      )
    : skills;

  if (loading && skills.length === 0) {
    return <div style={{ color: colors.subtext0, padding: '40px', textAlign: 'center' }}>Loading skills...</div>;
  }

  return (
    <div style={{ maxWidth: '1100px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ color: colors.subtext0, fontSize: '14px' }}>
          {skills.length} skill{skills.length !== 1 ? 's' : ''} available
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter skills..."
            data-1p-ignore
            style={{ ...baseStyles.input, width: '200px', padding: '6px 12px', fontSize: '13px' }}
          />
          <button
            onClick={load}
            style={{ ...baseStyles.button.secondary, fontSize: '13px', padding: '6px 12px' }}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            color: colors.red,
            padding: '12px',
            backgroundColor: `${colors.red}11`,
            borderRadius: '6px',
            marginBottom: '16px',
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}

      {filtered.length === 0 ? (
        <div
          style={{
            ...baseStyles.card,
            textAlign: 'center',
            padding: '60px',
            color: colors.overlay0,
          }}
        >
          {filter ? 'No skills match the filter.' : 'No skills loaded. Add .md files to the skills/ directory.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
          {filtered.map((skill) => (
            <div
              key={skill.id}
              onClick={() => setSelected(skill)}
              style={{
                ...baseStyles.card,
                cursor: 'pointer',
                transition: 'border-color 0.15s',
                borderColor: colors.surface1,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = colors.blue)}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = colors.surface1)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <h4 style={{ margin: 0, color: colors.text, fontSize: '14px', fontWeight: '600' }}>{skill.name}</h4>
                <CategoryBadge category={skill.category} />
              </div>
              {skill.description && (
                <p style={{ margin: '0 0 10px', color: colors.subtext0, fontSize: '13px', lineHeight: '1.4' }}>
                  {skill.description}
                </p>
              )}
              <RequiredTools tools={skill.required_tools} />
              <div style={{ marginTop: '10px', fontSize: '11px', color: colors.overlay0, fontFamily: 'monospace' }}>
                {skill.id}
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && <SkillDetailModal skill={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
