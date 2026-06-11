/**
 * VerificationBanner — shown at the top of the app for unverified (basic) users.
 * Displays days remaining before auto-deletion and a button to verify.
 */

import React, { useState } from 'react';
import { useNetworkStore } from '../stores/networkStore.js';
import EmailVerificationModal from '../pages/EmailVerificationModal.js';

export default function VerificationBanner(): React.JSX.Element | null {
  const { accountInfo } = useNetworkStore();
  const [showVerify, setShowVerify] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Don't show for verified users or if no account info yet
  if (!accountInfo || accountInfo.tier === 'verified' || dismissed) return null;

  const days = accountInfo.daysRemaining;
  const phase = accountInfo.phase ?? 'verify';
  const grace = phase === 'grace';
  const d = (n: number) => `${n} day${n !== 1 ? 's' : ''}`;
  // Grace phase is always urgent (verification window already lapsed); verify
  // phase turns urgent in the last week.
  const urgent = grace || days <= 7;

  const message = grace
    ? `Verification window ended — ${d(days)} of access left. Sign in regularly to keep it, or verify your email to keep your account for good.`
    : urgent
      ? `Only ${d(days)} left to verify your email! After that you get a 30-day grace period, then the account is deleted.`
      : `Unverified account — ${d(days)} to verify your email. Some features are restricted.`;

  return (
    <>
      <div style={{ ...styles.banner, background: urgent ? 'var(--color-bg-danger, #3a1515)' : 'var(--color-bg-warning, #3a2e15)' }}>
        <div style={styles.content}>
          <span style={{ ...styles.icon, color: urgent ? '#E24B4A' : '#EF9F27' }}>
            {urgent ? '!' : 'i'}
          </span>
          <span style={styles.text}>{message}</span>
          <button onClick={() => setShowVerify(true)} style={styles.verifyBtn}>
            Verify email
          </button>
          <button onClick={() => setDismissed(true)} style={styles.dismissBtn} title="Dismiss for this session">
            ✕
          </button>
        </div>

        {/* Feature restrictions info */}
        <div style={styles.restrictions}>
          Cannot: create communities or squads • start DMs • delete conversations
        </div>
      </div>

      {showVerify && <EmailVerificationModal onClose={() => setShowVerify(false)} />}
    </>
  );
}

const styles = {
  banner: {
    padding: '8px 16px',
    borderBottom: '1px solid var(--color-border)',
    flexShrink: 0,
  } as React.CSSProperties,
  content: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  } as React.CSSProperties,
  icon: {
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    border: '2px solid currentColor',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 700,
    flexShrink: 0,
  } as React.CSSProperties,
  text: {
    flex: 1,
    fontSize: '12px',
    color: 'var(--color-text-secondary)',
  } as React.CSSProperties,
  verifyBtn: {
    padding: '4px 12px',
    borderRadius: '4px',
    border: 'none',
    background: 'var(--color-accent)',
    color: '#fff',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    flexShrink: 0,
  } as React.CSSProperties,
  dismissBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '2px 4px',
    flexShrink: 0,
  } as React.CSSProperties,
  restrictions: {
    fontSize: '10px',
    color: 'var(--color-text-muted)',
    marginTop: '4px',
    paddingLeft: '30px',
    fontFamily: 'var(--font-mono)',
  } as React.CSSProperties,
} as const;
