/**
 * CreateChannelModal — create a new channel in a community.
 * Only visible to admin+ roles.
 */

import React, { useState } from 'react';
import { useCommunityStore } from '../stores/communityStore.js';

interface Props {
  communityId: string;
  onClose: () => void;
}

export default function CreateChannelModal({ communityId, onClose }: Props): React.JSX.Element {
  const { createChannel } = useCommunityStore();
  const [name, setName] = useState('');
  const [type, setType] = useState<'text' | 'voice'>('text');
  const [visibility, setVisibility] = useState<'public' | 'private' | 'readonly'>('public');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');

  const handleCreate = async (): Promise<void> => {
    if (!cleanName) return;
    setLoading(true);
    setError(null);
    try {
      await createChannel(communityId, cleanName, type, visibility);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create channel');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>Create Channel</span>
          <button onClick={onClose} style={styles.closeBtn}>&#x2715;</button>
        </div>

        <div style={styles.body}>
          <label style={styles.label}>
            Channel name
            <div style={styles.nameInputWrap}>
              <span style={styles.hashPrefix}>#</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="new-channel"
                disabled={loading}
                autoFocus
                style={styles.nameInput}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                maxLength={32}
              />
            </div>
            {name && cleanName !== name.trim() && (
              <span style={styles.preview}>Will be created as: #{cleanName}</span>
            )}
          </label>

          <label style={styles.label}>
            Channel type
            <div style={styles.optionRow}>
              <button
                onClick={() => setType('text')}
                style={{ ...styles.optionBtn, ...(type === 'text' ? styles.optionActive : {}) }}
              >
                <span style={styles.optionIcon}>#</span> Text
              </button>
              <button
                onClick={() => setType('voice')}
                style={{ ...styles.optionBtn, ...(type === 'voice' ? styles.optionActive : {}) }}
              >
                <span style={{ ...styles.optionIcon, color: 'var(--color-green)' }}>&#x25C8;</span> Voice
              </button>
            </div>
          </label>

          <label style={styles.label}>
            Visibility
            <div style={styles.optionRow}>
              {(['public', 'private', 'readonly'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setVisibility(v)}
                  style={{ ...styles.optionBtn, ...(visibility === v ? styles.optionActive : {}) }}
                >
                  {v === 'public' ? 'Public' : v === 'private' ? 'Private' : 'Read-only'}
                </button>
              ))}
            </div>
          </label>

          {error && <p style={styles.error}>{error}</p>}
        </div>

        <div style={styles.footer}>
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={loading || !cleanName}
          >
            {loading ? 'Creating...' : 'Create channel'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 } as React.CSSProperties,
  modal: { background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '440px', overflow: 'hidden' } as React.CSSProperties,
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--color-border)' } as React.CSSProperties,
  title: { fontSize: '16px', fontWeight: 600 } as React.CSSProperties,
  closeBtn: { background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '16px', padding: '4px' } as React.CSSProperties,
  body: { padding: '20px', display: 'flex', flexDirection: 'column' as const, gap: '16px' } as React.CSSProperties,
  label: { display: 'flex', flexDirection: 'column' as const, gap: '6px', fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 } as React.CSSProperties,
  nameInputWrap: { display: 'flex', alignItems: 'center', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' } as React.CSSProperties,
  hashPrefix: { padding: '10px 0 10px 12px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', fontSize: '14px', flexShrink: 0 } as React.CSSProperties,
  nameInput: { flex: 1, padding: '10px 12px 10px 4px', background: 'transparent', border: 'none', color: 'var(--color-text-primary)', outline: 'none', fontSize: '13px', fontFamily: 'inherit' } as React.CSSProperties,
  preview: { fontSize: '11px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' } as React.CSSProperties,
  optionRow: { display: 'flex', gap: '8px' } as React.CSSProperties,
  optionBtn: { flex: 1, padding: '8px 12px', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center', transition: 'border-color 0.15s, color 0.15s' } as React.CSSProperties,
  optionActive: { borderColor: 'var(--color-accent)', color: 'var(--color-accent)' } as React.CSSProperties,
  optionIcon: { fontFamily: 'var(--font-mono)', fontSize: '14px' } as React.CSSProperties,
  error: { fontSize: '13px', color: 'var(--color-red)', padding: '8px 12px', background: 'rgba(240,96,96,0.08)', border: '1px solid rgba(240,96,96,0.3)', borderRadius: 'var(--radius-md)' } as React.CSSProperties,
  footer: { display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '16px 20px', borderTop: '1px solid var(--color-border)' } as React.CSSProperties,
} as const;
