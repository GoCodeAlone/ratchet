import { useEffect } from 'react';
import { useAuthStore } from './store/authStore';
import LoginPage from './components/LoginPage';
import Layout from './components/Layout';
import OAuthCallback from './components/OAuthCallback';

export default function App() {
  const { isAuthenticated, loadUser } = useAuthStore();

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
  return <Layout />;
}
