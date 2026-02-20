import { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { colors } from '../theme';
import Dashboard from './Dashboard';
import AgentList from './AgentList';
import TaskList from './TaskList';
import MessageFeed from './MessageFeed';
import Settings from './Settings';

type NavItem = 'dashboard' | 'agents' | 'tasks' | 'messages' | 'settings';

const navItems: { id: NavItem; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '[D]' },
  { id: 'agents', label: 'Agents', icon: '[A]' },
  { id: 'tasks', label: 'Tasks', icon: '[T]' },
  { id: 'messages', label: 'Messages', icon: '[M]' },
  { id: 'settings', label: 'Settings', icon: '[S]' },
];

export default function Layout() {
  const [active, setActive] = useState<NavItem>('dashboard');
  const { user, logout } = useAuthStore();

  function renderContent() {
    switch (active) {
      case 'dashboard': return <Dashboard onNavigate={setActive} />;
      case 'agents': return <AgentList />;
      case 'tasks': return <TaskList />;
      case 'messages': return <MessageFeed />;
      case 'settings': return <Settings />;
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: colors.base }}>
      {/* Sidebar */}
      <div
        style={{
          width: '220px',
          flexShrink: 0,
          backgroundColor: colors.mantle,
          borderRight: `1px solid ${colors.surface0}`,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Logo */}
        <div
          style={{
            padding: '20px 16px',
            borderBottom: `1px solid ${colors.surface0}`,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: '20px',
              fontWeight: '700',
              color: colors.blue,
              letterSpacing: '-0.5px',
            }}
          >
            Ratchet
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: '11px', color: colors.overlay0 }}>
            AI Agent Platform
          </p>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 8px' }}>
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActive(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                width: '100%',
                padding: '10px 10px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: active === item.id ? colors.surface0 : 'transparent',
                color: active === item.id ? colors.text : colors.subtext0,
                fontSize: '14px',
                fontWeight: active === item.id ? '500' : '400',
                textAlign: 'left',
                marginBottom: '2px',
                transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: '12px', fontFamily: 'monospace', color: active === item.id ? colors.blue : colors.overlay1 }}>
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </nav>

        {/* User footer */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: `1px solid ${colors.surface0}`,
          }}
        >
          <div style={{ fontSize: '13px', color: colors.subtext1, marginBottom: '8px' }}>
            {user?.username ?? 'User'}
          </div>
          <button
            onClick={logout}
            style={{
              width: '100%',
              padding: '7px',
              backgroundColor: colors.surface0,
              color: colors.subtext0,
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div
          style={{
            height: '56px',
            borderBottom: `1px solid ${colors.surface0}`,
            display: 'flex',
            alignItems: 'center',
            padding: '0 24px',
            backgroundColor: colors.base,
            flexShrink: 0,
          }}
        >
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: colors.text }}>
            {navItems.find((n) => n.id === active)?.label}
          </h3>
        </div>

        {/* Page content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
