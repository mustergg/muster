/**
 * Auth page — shown when the user is not logged in.
 * Toggles between Login and Sign Up forms.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/authStore.js';
import { useNetworkStore } from '../stores/networkStore.js';

type AuthMode = 'login' | 'signup';

export default function AuthPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { login, signup } = useAuthStore();
  const { connect } = useNetworkStore();

  const [mode, setMode]         = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);

    if (mode === 'signup' && password !== confirm) {
      setError(t('auth.errors.passwordMismatch'));
      return;
    }

    setLoading(true);
    try {
      if (mode === 'signup') {
        await signup(username.trim(), password);
      } else {
        await login(username.trim(), password);
      }
      // After successful auth, start the P2P node
      await connect();
    } catch (err: unknown) {
      const key = err instanceof Error ? err.message : 'errors.generic';
      // i18n key or raw message
      setError(t(key, { defaultValue: key }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {/* Logo / wordmark */}
        <div style={styles.logo}>
          <span style={styles.logoText}>MUSTER</span>
          <span style={styles.logoTagline}>{t('app.tagline')}</span>
        </div>

        {/* Mode tabs */}
        <div style={styles.tabs}>
          <button
            style={{ ...styles.tab, ...(mode === 'login'  ? styles.tabActive : {}) }}
            onClick={() => { setMode('login');  setError(null); }}
          >
            {t('auth.login')}
          </button>
          <button
            style={{ ...styles.tab, ...(mode === 'signup' ? styles.tabActive : {}) }}
            onClick={() => { setMode('signup'); setError(null); }}
          >
            {t('auth.signup')}
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>
            {t('auth.username')}
            <input
				id="username"
				name="username"
				type="text"
				value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('auth.usernamePlaceholder')}
              autoComplete="username"
              required
              disabled={loading}
            />
          </label>

          <label style={styles.label}>
            {t('auth.password')}
            <input
				id="password"
				name="password"
				type="password"
				value={password}
				onChange={(e) => setPassword(e.target.value)}
				placeholder={t('auth.passwordPlaceholder')}
				autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              required
              disabled={loading}
            />
          </label>

          {mode === 'signup' && (
            <label style={styles.label}>
              {t('auth.confirmPassword')}
              <input
				id="confirm-password"
				name="confirm-password"
				type="password"
				value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t('auth.confirmPasswordPlaceholder')}
                autoComplete="new-password"
                required
                disabled={loading}
              />
            </label>
          )}

          {error && <p style={styles.error}>{error}</p>}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '8px' }}
            disabled={loading}
          >
            {loading
              ? (mode === 'signup' ? t('auth.creatingAccount') : t('auth.loggingIn'))
              : (mode === 'signup' ? t('auth.signup') : t('auth.login'))
            }
          </button>
        </form>

        {/* Keystore warning for signup */}
        {mode === 'signup' && (
          <p style={styles.warning}>{t('auth.keystoreWarning')}</p>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--color-bg-tertiary)',
    padding: '24px',
  } as React.CSSProperties,

  card: {
    background: 'var(--color-bg-secondary)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    padding: '32px',
    width: '100%',
    maxWidth: '400px',
  } as React.CSSProperties,

  logo: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    marginBottom: '28px',
    gap: '4px',
  } as React.CSSProperties,

  logoText: {
    fontSize: '28px',
    fontWeight: '700',
    letterSpacing: '0.12em',
    color: 'var(--color-accent)',
  } as React.CSSProperties,

  logoTagline: {
    fontSize: '12px',
    color: 'var(--color-text-muted)',
    letterSpacing: '0.03em',
  } as React.CSSProperties,

  tabs: {
    display: 'flex',
    borderBottom: '1px solid var(--color-border)',
    marginBottom: '24px',
  } as React.CSSProperties,

  tab: {
    flex: 1,
    padding: '10px',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'color 0.15s, border-color 0.15s',
    marginBottom: '-1px',
  } as React.CSSProperties,

  tabActive: {
    color: 'var(--color-accent)',
    borderBottomColor: 'var(--color-accent)',
  } as React.CSSProperties,

  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
  } as React.CSSProperties,

  label: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
    fontSize: '13px',
    color: 'var(--color-text-secondary)',
    fontWeight: '500',
  } as React.CSSProperties,

  error: {
    fontSize: '13px',
    color: 'var(--color-red)',
    padding: '8px 12px',
    background: 'rgba(240,96,96,0.08)',
    border: '1px solid rgba(240,96,96,0.3)',
    borderRadius: 'var(--radius-md)',
  } as React.CSSProperties,

  warning: {
    marginTop: '20px',
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    lineHeight: '1.6',
    textAlign: 'center' as const,
  } as React.CSSProperties,
} as const;
