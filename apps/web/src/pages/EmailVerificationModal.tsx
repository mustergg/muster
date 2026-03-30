/**
 * EmailVerificationModal — two-step: enter email → enter code.
 */

import React, { useState } from 'react';
import { useNetworkStore } from '../stores/networkStore.js';
import type { TransportMessage } from '@muster/transport';

interface Props {
  onClose: () => void;
}

type Step = 'email' | 'code' | 'done';

export default function EmailVerificationModal({ onClose }: Props): React.JSX.Element {
  const { transport } = useNetworkStore();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleRegisterEmail = async () => {
    if (!email.includes('@')) { setError('Please enter a valid email address.'); return; }
    if (!transport?.isConnected) { setError('Not connected to relay.'); return; }

    setLoading(true);
    setError('');

    // Listen for response
    const cleanup = useNetworkStore.getState().onMessage((msg: TransportMessage) => {
      if (msg.type === 'EMAIL_REGISTERED') {
        cleanup();
        setLoading(false);
        const p = msg.payload as any;
        if (p.success) {
          setMessage(p.message);
          setStep('code');
        } else {
          setError(p.message);
        }
      }
    });

    transport.send({
      type: 'REGISTER_EMAIL',
      payload: { email },
      timestamp: Date.now(),
    });

    // Timeout
    setTimeout(() => { cleanup(); setLoading(false); }, 10000);
  };

  const handleVerifyCode = async () => {
    if (!code.trim()) { setError('Please enter the verification code.'); return; }
    if (!transport?.isConnected) { setError('Not connected to relay.'); return; }

    setLoading(true);
    setError('');

    const cleanup = useNetworkStore.getState().onMessage((msg: TransportMessage) => {
      if (msg.type === 'EMAIL_VERIFIED') {
        cleanup();
        setLoading(false);
        const p = msg.payload as any;
        if (p.success) {
          setMessage(p.message);
          setStep('done');
        } else {
          setError(p.message);
        }
      }
    });

    transport.send({
      type: 'VERIFY_EMAIL',
      payload: { code: code.trim() },
      timestamp: Date.now(),
    });

    setTimeout(() => { cleanup(); setLoading(false); }, 10000);
  };

  const handleResend = () => {
    if (!transport?.isConnected) return;
    transport.send({ type: 'RESEND_VERIFICATION', payload: {}, timestamp: Date.now() });
    setMessage('New code sent! Check your email or relay console.');
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>
            {step === 'email' ? 'Verify Your Email' : step === 'code' ? 'Enter Verification Code' : 'Verified!'}
          </span>
          <button onClick={onClose} style={styles.closeBtn}>&#x2715;</button>
        </div>

        <div style={styles.body}>
          {step === 'email' && (
            <>
              <p style={styles.desc}>
                Add your email to unlock all features: create communities, start DMs,
                and keep your account permanently.
              </p>
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRegisterEmail()}
                style={styles.input}
                autoFocus
              />
              <p style={styles.privacy}>
                Your email is never stored in plaintext — only a SHA-256 hash is saved
                for uniqueness checks. One account per email.
              </p>
            </>
          )}

          {step === 'code' && (
            <>
              <p style={styles.desc}>
                A verification code has been sent. Enter it below:
              </p>
              <input
                type="text"
                placeholder="Enter 8-character code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleVerifyCode()}
                style={{ ...styles.input, letterSpacing: '4px', textAlign: 'center', fontSize: '18px', fontFamily: 'var(--font-mono)' }}
                maxLength={8}
                autoFocus
              />
              <button onClick={handleResend} style={styles.linkBtn}>
                Didn't receive it? Resend code
              </button>
            </>
          )}

          {step === 'done' && (
            <div style={styles.successBox}>
              <span style={styles.successIcon}>&#x2713;</span>
              <p style={styles.successText}>Your account is now verified!</p>
              <p style={styles.desc}>All features are unlocked. Your account will not be auto-deleted.</p>
            </div>
          )}

          {error && <p style={styles.error}>{error}</p>}
          {message && !error && step !== 'done' && <p style={styles.success}>{message}</p>}
        </div>

        <div style={styles.footer}>
          {step === 'email' && (
            <button onClick={handleRegisterEmail} disabled={loading || !email.includes('@')} style={styles.primaryBtn}>
              {loading ? 'Sending...' : 'Send verification code'}
            </button>
          )}
          {step === 'code' && (
            <button onClick={handleVerifyCode} disabled={loading || code.length < 8} style={styles.primaryBtn}>
              {loading ? 'Verifying...' : 'Verify'}
            </button>
          )}
          {step === 'done' && (
            <button onClick={onClose} style={styles.primaryBtn}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 } as React.CSSProperties,
  modal: { background: 'var(--color-bg-secondary)', borderRadius: '12px', width: '400px', maxWidth: '90vw', boxShadow: '0 16px 48px rgba(0,0,0,0.5)', overflow: 'hidden' } as React.CSSProperties,
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--color-border)' } as React.CSSProperties,
  title: { fontSize: '16px', fontWeight: 600, color: 'var(--color-text-primary)' } as React.CSSProperties,
  closeBtn: { background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '16px' } as React.CSSProperties,
  body: { padding: '20px' } as React.CSSProperties,
  desc: { fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: '12px' } as React.CSSProperties,
  privacy: { fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: 1.4, marginTop: '10px', fontStyle: 'italic' } as React.CSSProperties,
  input: { width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-bg-input, var(--color-bg-tertiary))', color: 'var(--color-text-primary)', fontSize: '14px', outline: 'none', boxSizing: 'border-box' as const } as React.CSSProperties,
  linkBtn: { background: 'transparent', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: '12px', marginTop: '8px', padding: 0 } as React.CSSProperties,
  error: { fontSize: '12px', color: '#E24B4A', marginTop: '8px' } as React.CSSProperties,
  success: { fontSize: '12px', color: '#1D9E75', marginTop: '8px' } as React.CSSProperties,
  successBox: { textAlign: 'center' as const, padding: '16px 0' } as React.CSSProperties,
  successIcon: { fontSize: '40px', color: '#1D9E75', display: 'block', marginBottom: '8px' } as React.CSSProperties,
  successText: { fontSize: '16px', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '8px' } as React.CSSProperties,
  footer: { padding: '12px 20px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end' } as React.CSSProperties,
  primaryBtn: { padding: '8px 20px', borderRadius: '6px', border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
} as const;
