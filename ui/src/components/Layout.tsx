import { useState, useEffect } from 'react';
import { useLocation, useNavigate as useRouterNavigate, Routes, Route } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { colors } from '../theme';
import Dashboard, { NavFilter } from './Dashboard';
import AgentList from './AgentList';
import TaskList from './TaskList';
import MessageFeed from './MessageFeed';
import Settings from './Settings';
import ProjectList from './ProjectList';
import SkillList from './SkillList';
import RequestList from './RequestList';

type NavItem = 'dashboard' | 'agents' | 'tasks' | 'messages' | 'projects' | 'requests' | 'skills' | 'settings';

const navPaths: Record<NavItem, string> = {
  dashboard: '/',
  agents: '/agents',
  tasks: '/tasks',
  messages: '/messages',
  projects: '/projects',
  requests: '/requests',
  skills: '/skills',
  settings: '/settings',
};

function pathToNavItem(pathname: string): NavItem | null {
  if (pathname === '/') return 'dashboard';
  const found = (Object.entries(navPaths) as [NavItem, string][])
    .find(([, path]) => path !== '/' && pathname.startsWith(path));
  return found ? found[0] : null;
}

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
  const [navFilter, setNavFilter] = useState<NavFilter | undefined>(undefined);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const { user, logout } = useAuthStore();
  const location = useLocation();
  const routerNavigate = useRouterNavigate();

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const active = pathToNavItem(location.pathname);

  function navigate(page: NavItem, filter?: NavFilter) {
    setNavFilter(filter);
    routerNavigate(navPaths[page]);
    if (isMobile) setSidebarOpen(false);
  }

  const mobileSidebarStyle = isMobile
    ? {
        position: 'fixed' as const,
        top: 0,
        left: 0,
        height: '100%',
        zIndex: 100,
        transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
        visibility: sidebarOpen ? ('visible' as const) : ('hidden' as const),
        transition: sidebarOpen
          ? 'transform 0.25s ease, visibility 0s linear 0s'
          : 'transform 0.25s ease, visibility 0s linear 0.25s',
      }
    : {};

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: colors.base }}>
      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            zIndex: 99,
          }}
        />
      )}

      {/* Sidebar */}
      <div
        style={{
          width: '220px',
          flexShrink: 0,
          backgroundColor: colors.mantle,
          borderRight: `1px solid ${colors.surface0}`,
          display: 'flex',
          flexDirection: 'column',
          ...mobileSidebarStyle,
        }}
      >
        {/* Logo */}
        <div
          style={{
            padding: '20px 16px',
            borderBottom: `1px solid ${colors.surface0}`,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ overflow: 'hidden', minWidth: 0 }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: '20px',
                  fontWeight: '700',
                  color: colors.blue,
                  letterSpacing: '-0.5px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                Ratchet
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '11px', color: colors.overlay0 }}>
                AI Agent Platform
              </p>
            </div>
            {isMobile && (
              <button
                onClick={() => setSidebarOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: colors.overlay0,
                  cursor: 'pointer',
                  fontSize: '20px',
                  lineHeight: 1,
                  padding: '0 4px',
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 8px' }}>
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(item.id as NavItem)}
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
            onClick={() => {
              if (!window.confirm('Sign out of Ratchet?')) return;
              logout();
            }}
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
          {isMobile && (
            <button
              onClick={() => setSidebarOpen(true)}
              style={{
                background: 'none',
                border: 'none',
                color: colors.text,
                cursor: 'pointer',
                fontSize: '20px',
                lineHeight: 1,
                padding: '4px',
                marginRight: '12px',
              }}
              aria-label="Open menu"
            >
              ☰
            </button>
          )}
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: colors.text }}>
            {active ? navItems.find((n) => n.id === active)?.label : 'Page Not Found'}
          </h3>
        </div>

        {/* Page content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
          <Routes>
            <Route path="/" element={<Dashboard onNavigate={navigate} />} />
            <Route path="/agents" element={<AgentList />} />
            <Route path="/tasks" element={<TaskList initialFilter={navFilter} />} />
            <Route path="/messages" element={<MessageFeed />} />
            <Route path="/projects" element={<ProjectList />} />
            <Route path="/requests" element={<RequestList />} />
            <Route path="/skills" element={<SkillList />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '300px', gap: '16px' }}>
                <div style={{ fontSize: '48px', color: colors.overlay0 }}>404</div>
                <div style={{ fontSize: '18px', color: colors.subtext0 }}>Page not found</div>
                <button
                  onClick={() => navigate('dashboard')}
                  style={{ color: colors.blue, background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }}
                >
                  &larr; Return to Dashboard
                </button>
              </div>
            } />
          </Routes>
        </div>
      </div>
    </div>
  );
}
