import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCommunityStore } from '../stores/communityStore.js';

interface Props {
  onClose: () => void;
  onCreated: (communityId: string) => void;
}

export default function CreateCommunityModal({ onClose, onCreated }: Props): React.JSX.Element {
  const { t }            = useTranslation();
  const { createCommunity } = useCommunityStore();
  const [name, setName]  = useState('');
  const [desc, setDesc]  = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const handleCreate = async (): Promise<void> => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const community = await createCommunity(name.trim(), desc.trim() || undefined);
      onCreated(community.id);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create community');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>Create Community</span>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={styles.body}>
          <label style={styles.label}>
            Community name
            <input
              id="community-name"
              name="community-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My Gaming Community"
              disabled={loading}
              autoFocus
              style={styles.input}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </label>

          <label style={styles.label}>
            Description <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>(optional)</span>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="What is this community about?"
              disabled={loading}
              rows={3}
              style={{ ...styles.input, resize: 'vertical' as const }}
            />
          </label>

          {error && <p style={styles.error}>{error}</p>}
        </div>

        <div style={styles.footer}>
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={loading || !name.trim()}
          >
            {loading ? 'Creating…' : 'Create community'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  } as React.CSSProperties,
  modal: {
    background: 'var(--color-bg-secondary)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    width: '100%',
    maxWidth: '440px',
    overflow: 'hidden',
  } as React.CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid var(--color-border)',
  } as React.CSSProperties,
  title: {
    fontSize: '16px',
    fontWeight: 600,
  } as React.CSSProperties,
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    fontSize: '16px',
    padding: '4px',
  } as React.CSSProperties,
  body: {
    padding: '20px',
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
    fontWeight: 500,
  } as React.CSSProperties,
  input: {
    width: '100%',
    padding: '10px 12px',
    background: 'var(--color-bg-input)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--color-text-primary)',
    outline: 'none',
    fontSize: '13px',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  error: {
    fontSize: '13px',
    color: 'var(--color-red)',
    padding: '8px 12px',
    background: 'rgba(240,96,96,0.08)',
    border: '1px solid rgba(240,96,96,0.3)',
    borderRadius: 'var(--radius-md)',
  } as React.CSSProperties,
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    padding: '16px 20px',
    borderTop: '1px solid var(--color-border)',
  } as React.CSSProperties,
} as const;
