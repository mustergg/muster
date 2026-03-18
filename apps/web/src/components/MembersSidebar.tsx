import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNetworkStore } from '../stores/networkStore.js';

interface Props { communityId: string | null; }

export default function MembersSidebar({ communityId }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { peerCount, status } = useNetworkStore();

  return (
    <div style={styles.sidebar}>
      <div style={styles.header}>
        {t('community.members')} — {peerCount} online
      </div>
      <div style={styles.list}>
        {/* Phase 2: replace with real member list from presence topic */}
        <div style={styles.sectionTitle}>Online</div>
        <div style={styles.emptyNote}>
          {status !== 'connected'
            ? t('network.connecting')
            : 'Peers will appear here once connected to a community.'}
        </div>
      </div>

      {/* P2P stats panel */}
      <div style={styles.stats}>
        <div style={styles.statsTitle}>NODE STATUS</div>
        <StatRow label="peers" value={String(peerCount)} color="var(--color-green)" />
        <StatRow label="transport" value="WebSocket" color="var(--color-accent)" />
        <StatRow label="encryption" value="noise ✓" color="var(--color-green)" />
        <StatRow label="status" value={status} color={status === 'connected' ? 'var(--color-green)' : 'var(--color-amber)'} />
      </div>
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color: string }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
      <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color }}>{value}</span>
    </div>
  );
}

const styles = {
  sidebar: {
    width: 'var(--sidebar-members-w)',
    background: 'var(--color-bg-secondary)',
    borderLeft: '1px solid var(--color-border)',
    display: 'flex',
    flexDirection: 'column' as const,
    flexShrink: 0,
  } as React.CSSProperties,
  header: {
    padding: '12px 12px 8px',
    fontSize: '10px',
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    borderBottom: '1px solid var(--color-border)',
  } as React.CSSProperties,
  list: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '8px 0',
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: '10px',
    color: 'var(--color-text-muted)',
    fontFamily: 'var(--font-mono)',
    padding: '6px 12px 3px',
    letterSpacing: '0.05em',
  } as React.CSSProperties,
  emptyNote: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    padding: '4px 12px',
    lineHeight: 1.5,
  } as React.CSSProperties,
  stats: {
    padding: '8px 12px',
    borderTop: '1px solid var(--color-border)',
    background: 'var(--color-bg-tertiary)',
  } as React.CSSProperties,
  statsTitle: {
    fontSize: '9px',
    fontFamily: 'var(--font-mono)',
    color: 'var(--color-text-muted)',
    marginBottom: '5px',
    letterSpacing: '0.05em',
  } as React.CSSProperties,
} as const;
