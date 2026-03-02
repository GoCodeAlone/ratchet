import { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { colors } from '../theme';
import Dashboard from './Dashboard';
import AgentList from './AgentList';
import TaskList from './TaskList';
import MessageFeed from './MessageFeed';
import Settings from './Settings';
import ProjectList from './ProjectList';
import SkillList from './SkillList';
import RequestList from './RequestList';

type NavItem = 'dashboard' | 'agents' | 'tasks' | 'messages' | 'projects' | 'requests' | 'skills' | 'settings';

// SVG path data for each nav icon (Lucide-style)
const iconPaths: Record<NavItem, string[]> = {
  dashboard: ['M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'],
  agents: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  tasks: ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
  messages: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  projects: ['M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'],
  requests: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M12 18v-6', 'M9 15h6'],
  skills: ['M12 2L2 7l10 5 10-5-10-5z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5'],
  settings: ['M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
};

const navItems: { id: NavItem; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'agents', label: 'Agents' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'messages', label: 'Messages' },
  { id: 'projects', label: 'Projects' },
  { id: 'requests', label: 'Requests' },
  { id: 'skills', label: 'Skills' },
  { id: 'settings', label: 'Settings' },
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
      case 'projects': return <ProjectList />;
      case 'requests': return <RequestList />;
      case 'skills': return <SkillList />;
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke={active === item.id ? colors.blue : colors.overlay1}
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {iconPaths[item.id].map((d, i) => <path key={i} d={d} />)}
              </svg>
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
            {String(user && 'username' in user ? user.username : user?.email ?? 'User')}
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
