import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNetworkStore } from '../stores/networkStore.js';
import { useCommunityStore } from '../stores/communityStore.js';

interface Props {
  communityId: string | null;
  onOpenDM?: (publicKey: string) => void;
}

const ROLE_BADGE: Record<string, { label: string; color: string }> = {
  owner:     { label: '\u{1F451}', color: '#FFD700' },
  admin:     { label: '\u{1F6E1}\uFE0F', color: '#3B82F6' },
  moderator: { label: '\u{1F528}', color: '#8B5CF6' },
  member:    { label: '',          color: '' },
};

export default function MembersSidebar({ communityId, onOpenDM }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { peerCount, status, publicKey: myKey } = useNetworkStore();
  const { onlineMembers } = useCommunityStore();

  const members = communityId ? (onlineMembers[communityId] ?? []) : [];

  return (
    <div style={styles.sidebar}>
      <div style={styles.header}>
        {t('community.members')} — {members.length || peerCount} online
      </div>
      <div style={styles.list}>
        {members.length > 0 ? (
          <>
            <div style={styles.sectionTitle}>Online — {members.length}</div>
            {members.map((m) => {
              const key = m.publicKey;
              const hue = parseInt((key || '0000').slice(0, 4), 16) % 360;
              const isMe = key === myKey;

              return (
                <div key={key} style={styles.memberItem}>
                  <div style={{ ...styles.avatar, background: `hsl(${hue},40%,20%)`, color: `hsl(${hue},70%,65%)`, position: 'relative' as const }}>
                    {(m.username || '??').slice(0, 2).toUpperCase()}
                    <div style={styles.onlineDot} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={styles.memberName}>
                      {m.username}{isMe ? ' (you)' : ''}
                    </span>
                  </div>
                  {!isMe && onOpenDM && (
                    <button
                      onClick={() => onOpenDM(key)}
                      style={styles.dmBtn}
                      title={`DM ${m.username}`}
                    >
                      DM
                    </button>
                  )}
                </div>
              );
            })}
          </>
        ) : (
          <div style={styles.emptyNote}>
            {status !== 'connected'
              ? t('network.connecting')
              : communityId
                ? 'No other members online yet.'
                : 'Select a community to see members.'}
          </div>
        )}
      </div>

      <div style={styles.stats}>
        <div style={styles.statsTitle}>NODE STATUS</div>
        <StatRow label="peers"      value={String(peerCount)}   color="var(--color-green)" />
        <StatRow label="transport"  value="WebSocket"           color="var(--color-accent)" />
        <StatRow label="encryption" value="E2E ready"           color="var(--color-green)" />
        <StatRow label="status"     value={status}              color={status === 'connected' ? 'var(--color-green)' : 'var(--color-amber)'} />
      </div>
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color: string }): React.JSX.Element {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'3px' }}>
      <span style={{ fontSize:'10px', color:'var(--color-text-muted)' }}>{label}</span>
      <span style={{ fontSize:'10px', fontFamily:'var(--font-mono)', color }}>{value}</span>
    </div>
  );
}

const styles = {
  sidebar:     { width:'var(--sidebar-members-w)', background:'var(--color-bg-secondary)', borderLeft:'1px solid var(--color-border)', display:'flex', flexDirection:'column' as const, flexShrink:0 } as React.CSSProperties,
  header:      { padding:'12px 12px 8px', fontSize:'10px', fontWeight:600, color:'var(--color-text-muted)', letterSpacing:'0.1em', textTransform:'uppercase' as const, borderBottom:'1px solid var(--color-border)' } as React.CSSProperties,
  list:        { flex:1, overflowY:'auto' as const, padding:'8px 0' } as React.CSSProperties,
  sectionTitle:{ fontSize:'10px', color:'var(--color-text-muted)', fontFamily:'var(--font-mono)', padding:'6px 12px 3px', letterSpacing:'0.05em' } as React.CSSProperties,
  memberItem:  { display:'flex', alignItems:'center', gap:'8px', padding:'4px 12px', cursor:'pointer', transition:'background 0.1s' } as React.CSSProperties,
  avatar:      { width:'28px', height:'28px', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', fontWeight:700, flexShrink:0 } as React.CSSProperties,
  onlineDot:   { position:'absolute' as const, bottom:'-1px', right:'-1px', width:'9px', height:'9px', borderRadius:'50%', background:'var(--color-green)', border:'2px solid var(--color-bg-secondary)' } as React.CSSProperties,
  memberName:  { fontSize:'12px', color:'var(--color-text-secondary)' } as React.CSSProperties,
  emptyNote:   { fontSize:'11px', color:'var(--color-text-muted)', padding:'4px 12px', lineHeight:1.5 } as React.CSSProperties,
  dmBtn:       { fontSize:'9px', padding:'2px 6px', borderRadius:'4px', border:'1px solid var(--color-border)', background:'transparent', color:'var(--color-text-muted)', cursor:'pointer', flexShrink:0, fontFamily:'var(--font-mono)' } as React.CSSProperties,
  stats:       { padding:'8px 12px', borderTop:'1px solid var(--color-border)', background:'var(--color-bg-tertiary)' } as React.CSSProperties,
  statsTitle:  { fontSize:'9px', fontFamily:'var(--font-mono)', color:'var(--color-text-muted)', marginBottom:'5px', letterSpacing:'0.05em' } as React.CSSProperties,
} as const;
