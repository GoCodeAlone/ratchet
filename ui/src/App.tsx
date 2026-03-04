import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import LoginPage from './components/LoginPage';
import Layout from './components/Layout';
import OAuthCallback from './components/OAuthCallback';

export default function App() {
  const { isAuthenticated, loadUser, token } = useAuthStore();

  useEffect(() => {
    if (isAuthenticated) {
      loadUser().catch(() => {/* token may be expired, loadUser handles cleanup */});
    }
  }, [isAuthenticated, loadUser]);

  // Handle OAuth callbacks in popup windows
  if (window.location.pathname.startsWith('/oauth/')) {
    return <OAuthCallback />;
  }

  if (!isAuthenticated) return <LoginPage />;

  // After login, redirect away from /login to the dashboard
  if (window.location.pathname === '/login') {
    return <Navigate to="/" replace />;
  }

  return <Layout key={token || ''} />;
}
