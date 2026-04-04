/**
 * EditProfileModal — edit display name, bio, links.
 * Opens from the user panel in ChannelsSidebar.
 */

import React, { useState, useEffect } from 'react';
import { useNetworkStore } from '../stores/networkStore.js';
import { useAuthStore } from '../stores/authStore.js';
import type { TransportMessage } from '@muster/transport';

interface Props {
  onClose: () => void;
}

type NameType = 'name' | 'nickname' | 'gamertag';

export default function EditProfileModal({ onClose }: Props): React.JSX.Element {
  const { transport, publicKey } = useNetworkStore();
  const { username } = useAuthStore();

  const [displayName, setDisplayName] = useState('');
  const [nameType, setNameType] = useState<NameType>('nickname');
  const [bio, setBio] = useState('');
  const [links, setLinks] = useState<string[]>(['']);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Load current profile
  useEffect(() => {
    if (!transport?.isConnected) return;

    const cleanup = useNetworkStore.getState().onMessage((msg: TransportMessage) => {
      if (msg.type === 'PROFILE_DATA') {
        const p = msg.payload as any;
        if (p.publicKey === publicKey) {
          setDisplayName(p.displayName || '');
          setNameType((p.displayNameType as NameType) || 'nickname');
          setBio(p.bio || '');
          setLinks(p.links?.length > 0 ? p.links : ['']);
          setLoading(false);
        }
      }
      if (msg.type === 'PROFILE_UPDATED') {
        const p = msg.payload as any;
        setSaving(false);
        if (p.success) {
          setMessage('Profile saved!');
          setTimeout(() => onClose(), 1000);
        } else {
          setError(p.message || 'Failed to save profile');
        }
      }
    });

    transport.send({
      type: 'GET_PROFILE',
      payload: { publicKey },
      timestamp: Date.now(),
    });

    // Fallback if no profile exists yet
    setTimeout(() => { if (loading) setLoading(false); }, 3000);

    return cleanup;
  }, [publicKey]);

  const handleSave = () => {
    if (!transport?.isConnected) return;
    setSaving(true);
    setError('');
    setMessage('');

    const cleanLinks = links.map((l) => l.trim()).filter(Boolean);

    transport.send({
      type: 'UPDATE_PROFILE',
      payload: {
        displayName: displayName.trim(),
        displayNameType: nameType,
        bio: bio.trim(),
        links: cleanLinks,
      },
      timestamp: Date.now(),
    });
  };

  const addLink = () => {
    if (links.length < 5) setLinks([...links, '']);
  };

  const removeLink = (index: number) => {
    setLinks(links.filter((_, i) => i !== index));
  };

  const updateLink = (index: number, value: string) => {
    const updated = [...links];
    updated[index] = value;
    setLinks(updated);
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>Edit profile</span>
          <button onClick={onClose} style={styles.closeBtn}>&#x2715;</button>
        </div>

        <div style={styles.body}>
          {loading ? (
            <p style={styles.loadingText}>Loading profile...</p>
          ) : (
            <>
              <div style={styles.usernameRow}>
                <span style={styles.usernameLabel}>Username</span>
                <span style={styles.usernameValue}>@{username}</span>
              </div>

              <label style={styles.label}>
                Display name
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How you want to be called"
                  maxLength={64}
                  style={styles.input}
                />
              </label>

              <label style={styles.label}>
                Name type
                <div style={styles.typeRow}>
                  {(['name', 'nickname', 'gamertag'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setNameType(t)}
                      style={{
                        ...styles.typeBtn,
                        ...(nameType === t ? styles.typeBtnActive : {}),
                      }}
                    >
                      {t === 'name' ? 'Name' : t === 'nickname' ? 'Nickname' : 'GamerTag'}
                    </button>
                  ))}
                </div>
              </label>

              <label style={styles.label}>
                Bio
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Tell people about yourself"
                  maxLength={500}
                  rows={3}
                  style={{ ...styles.input, resize: 'vertical' as const }}
                />
                <span style={styles.charCount}>{bio.length}/500</span>
              </label>

              <div style={styles.label}>
                <span>Links <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(max 5)</span></span>
                {links.map((link, i) => (
                  <div key={i} style={styles.linkRow}>
                    <input
                      type="url"
                      value={link}
                      onChange={(e) => updateLink(i, e.target.value)}
                      placeholder="https://..."
                      style={{ ...styles.input, flex: 1 }}
                    />
                    {links.length > 1 && (
                      <button onClick={() => removeLink(i)} style={styles.removeLinkBtn}>&#x2715;</button>
                    )}
                  </div>
                ))}
                {links.length < 5 && (
                  <button onClick={addLink} style={styles.addLinkBtn}>+ Add link</button>
                )}
              </div>

              {error && <p style={styles.error}>{error}</p>}
              {message && <p style={styles.success}>{message}</p>}
            </>
          )}
        </div>

        <div style={styles.footer}>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Saving...' : 'Save profile'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 } as React.CSSProperties,
  modal: { background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '460px', overflow: 'hidden', maxHeight: '90vh', display: 'flex', flexDirection: 'column' as const } as React.CSSProperties,
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 } as React.CSSProperties,
  title: { fontSize: '16px', fontWeight: 600 } as React.CSSProperties,
  closeBtn: { background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '16px', padding: '4px' } as React.CSSProperties,
  body: { padding: '20px', display: 'flex', flexDirection: 'column' as const, gap: '16px', overflowY: 'auto' as const, flex: 1 } as React.CSSProperties,
  loadingText: { fontSize: '13px', color: 'var(--color-text-muted)', textAlign: 'center' as const } as React.CSSProperties,
  usernameRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--color-bg-hover)', borderRadius: 'var(--radius-md)' } as React.CSSProperties,
  usernameLabel: { fontSize: '12px', color: 'var(--color-text-muted)' } as React.CSSProperties,
  usernameValue: { fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--color-accent)' } as React.CSSProperties,
  label: { display: 'flex', flexDirection: 'column' as const, gap: '6px', fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 } as React.CSSProperties,
  input: { width: '100%', padding: '10px 12px', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', outline: 'none', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' as const } as React.CSSProperties,
  typeRow: { display: 'flex', gap: '6px' } as React.CSSProperties,
  typeBtn: { padding: '6px 12px', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '12px', transition: 'border-color 0.15s, color 0.15s' } as React.CSSProperties,
  typeBtnActive: { borderColor: 'var(--color-accent)', color: 'var(--color-accent)' } as React.CSSProperties,
  charCount: { fontSize: '10px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', alignSelf: 'flex-end' as const } as React.CSSProperties,
  linkRow: { display: 'flex', gap: '6px', alignItems: 'center' } as React.CSSProperties,
  removeLinkBtn: { width: '28px', height: '28px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } as React.CSSProperties,
  addLinkBtn: { background: 'transparent', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: '12px', padding: '4px 0', alignSelf: 'flex-start' as const } as React.CSSProperties,
  error: { fontSize: '12px', color: '#E24B4A' } as React.CSSProperties,
  success: { fontSize: '12px', color: '#1D9E75' } as React.CSSProperties,
  footer: { display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '16px 20px', borderTop: '1px solid var(--color-border)', flexShrink: 0 } as React.CSSProperties,
} as const;
