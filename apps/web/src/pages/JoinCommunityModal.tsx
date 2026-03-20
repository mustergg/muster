import React, { useState } from 'react';
import { useCommunityStore, parseInviteLink } from '../stores/communityStore.js';

interface Props {
  onClose: () => void;
  onJoined: (communityId: string) => void;
  /** Pre-filled from URL query param */
  prefillLink?: string;
}

export default function JoinCommunityModal({ onClose, onJoined, prefillLink }: Props): React.JSX.Element {
  const { joinCommunity } = useCommunityStore();
  const [link, setLink]   = useState(prefillLink ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

const handleJoin = async (): Promise<void> => {
  setError(null);
  const trimmed = link.trim();
  if (!trimmed) return;

  const communityId = parseInviteLink(trimmed);
  console.log('[Join] Parsed community ID:', communityId, 'from:', trimmed);
  
  if (!communityId) {
    setError('Invalid invite link. Please paste the full invite link.');
    return;
  }

  setLoading(true);
  try {
    const community = await joinCommunity(communityId);
    onJoined(community.id);
    onClose();
  } catch (err: unknown) {
    setError(err instanceof Error ? err.message : 'Failed to join community');
  } finally {
    setLoading(false);
  }
};

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>Join Community</span>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={styles.body}>
          <p style={styles.hint}>
            Paste an invite link or community ID to join an existing community.
            The community creator must be online for the first sync.
          </p>

          <label style={styles.label}>
            Invite link or community ID
            <input
              id="invite-link"
              name="invite-link"
              type="text"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://...?join=... or community-id"
              disabled={loading}
              autoFocus
              style={styles.input}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            />
          </label>

          {loading && (
            <p style={styles.syncing}>
              ⏳ Connecting to community… this may take a few seconds.
            </p>
          )}

          {error && <p style={styles.error}>{error}</p>}
        </div>

        <div style={styles.footer}>
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleJoin}
            disabled={loading || !link.trim()}
          >
            {loading ? 'Joining…' : 'Join community'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: { position:'fixed' as const, inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 } as React.CSSProperties,
  modal:   { background:'var(--color-bg-secondary)', border:'1px solid var(--color-border)', borderRadius:'var(--radius-lg)', width:'100%', maxWidth:'440px', overflow:'hidden' } as React.CSSProperties,
  header:  { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px', borderBottom:'1px solid var(--color-border)' } as React.CSSProperties,
  title:   { fontSize:'16px', fontWeight:600 } as React.CSSProperties,
  closeBtn:{ background:'transparent', border:'none', color:'var(--color-text-muted)', cursor:'pointer', fontSize:'16px', padding:'4px' } as React.CSSProperties,
  body:    { padding:'20px', display:'flex', flexDirection:'column' as const, gap:'14px' } as React.CSSProperties,
  hint:    { fontSize:'13px', color:'var(--color-text-muted)', lineHeight:1.6 } as React.CSSProperties,
  label:   { display:'flex', flexDirection:'column' as const, gap:'6px', fontSize:'13px', color:'var(--color-text-secondary)', fontWeight:500 } as React.CSSProperties,
  input:   { width:'100%', padding:'10px 12px', background:'var(--color-bg-input)', border:'1px solid var(--color-border)', borderRadius:'var(--radius-md)', color:'var(--color-text-primary)', outline:'none', fontSize:'13px', fontFamily:'inherit' } as React.CSSProperties,
  syncing: { fontSize:'13px', color:'var(--color-amber)', padding:'8px 12px', background:'rgba(245,166,35,0.08)', border:'1px solid rgba(245,166,35,0.3)', borderRadius:'var(--radius-md)' } as React.CSSProperties,
  error:   { fontSize:'13px', color:'var(--color-red)', padding:'8px 12px', background:'rgba(240,96,96,0.08)', border:'1px solid rgba(240,96,96,0.3)', borderRadius:'var(--radius-md)' } as React.CSSProperties,
  footer:  { display:'flex', justifyContent:'flex-end', gap:'8px', padding:'16px 20px', borderTop:'1px solid var(--color-border)' } as React.CSSProperties,
} as const;
