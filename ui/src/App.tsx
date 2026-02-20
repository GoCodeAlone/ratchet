import { useEffect } from 'react';
import { useAuthStore } from './store/authStore';
import LoginPage from './components/LoginPage';
import Layout from './components/Layout';

export default function App() {
  const { isAuthenticated, loadUser } = useAuthStore();

  useEffect(() => {
    if (isAuthenticated) {
      loadUser().catch(() => {/* token may be expired, loadUser handles cleanup */});
    }
  }, [isAuthenticated, loadUser]);

  if (!isAuthenticated) return <LoginPage />;
  return <Layout />;
}
