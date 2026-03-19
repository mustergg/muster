import React, { useState } from 'react';
import { useCommunityStore } from '../stores/communityStore.js';

interface Props {
  communityId: string;
  communityName: string;
  onClose: () => void;
}

export default function InviteLinkModal({ communityId, communityName, onClose }: Props): React.JSX.Element {
  const { generateInvite } = useCommunityStore();
  const [link]    = useState(() => generateInvite(communityId));
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>Invite to {communityName}</span>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={styles.body}>
          <p style={styles.hint}>
            Share this link with anyone you want to invite. They will need to be online
            at the same time as you for the first sync (P2P).
          </p>

          <div style={styles.linkBox}>
            <span style={styles.linkText}>{link}</span>
          </div>

          <button
            className="btn btn-primary"
            onClick={handleCopy}
            style={{ width: '100%' }}
          >
            {copied ? '✓ Copied!' : 'Copy invite link'}
          </button>

          <p style={styles.note}>
            Community ID: <code style={styles.code}>{communityId}</code>
          </p>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay:  { position:'fixed' as const, inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 } as React.CSSProperties,
  modal:    { background:'var(--color-bg-secondary)', border:'1px solid var(--color-border)', borderRadius:'var(--radius-lg)', width:'100%', maxWidth:'460px', overflow:'hidden' } as React.CSSProperties,
  header:   { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px', borderBottom:'1px solid var(--color-border)' } as React.CSSProperties,
  title:    { fontSize:'16px', fontWeight:600 } as React.CSSProperties,
  closeBtn: { background:'transparent', border:'none', color:'var(--color-text-muted)', cursor:'pointer', fontSize:'16px', padding:'4px' } as React.CSSProperties,
  body:     { padding:'20px', display:'flex', flexDirection:'column' as const, gap:'14px' } as React.CSSProperties,
  hint:     { fontSize:'13px', color:'var(--color-text-muted)', lineHeight:1.6 } as React.CSSProperties,
  linkBox:  { background:'var(--color-bg-input)', border:'1px solid var(--color-border)', borderRadius:'var(--radius-md)', padding:'10px 12px', wordBreak:'break-all' as const } as React.CSSProperties,
  linkText: { fontSize:'12px', fontFamily:'var(--font-mono)', color:'var(--color-accent)' } as React.CSSProperties,
  note:     { fontSize:'12px', color:'var(--color-text-muted)', textAlign:'center' as const } as React.CSSProperties,
  code:     { fontFamily:'var(--font-mono)', fontSize:'11px', background:'var(--color-bg-hover)', padding:'2px 6px', borderRadius:'4px' } as React.CSSProperties,
} as const;
