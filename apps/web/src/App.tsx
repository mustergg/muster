/**
 * Muster — root application component
 *
 * Handles top-level routing:
 *   - If user has a keystore → show main layout (communities, channels)
 *   - If no keystore        → show auth screen (login / signup)
 */

import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from './stores/authStore.js';
import AuthPage from './pages/AuthPage.js';
import MainLayout from './pages/MainLayout.js';
import NetworkStatusBar from './components/NetworkStatusBar.js';

export default function App(): React.JSX.Element {
  const { t } = useTranslation();
  const { isAuthenticated, rehydrate } = useAuthStore();

  // On mount: attempt to rehydrate session from local keystore
  useEffect(() => {
    rehydrate().catch((err: unknown) => {
      console.warn('[Auth] Rehydration failed:', err);
    });
  }, [rehydrate]);

  return (
    <div className="app-root">
      <NetworkStatusBar />
      {isAuthenticated ? <MainLayout /> : <AuthPage />}
    </div>
  );
}
