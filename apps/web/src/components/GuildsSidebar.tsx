import React from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  activeCommunityId: string | null;
  onSelectCommunity: (id: string) => void;
}

// Phase 1: static placeholder communities
// Phase 2: replace with real community list from OrbitDB
const DEMO_COMMUNITIES = [
  { id: 'demo-1', initials: 'TN', color: '#1a3a6b', bg: '#d0dcf0' },
  { id: 'demo-2', initials: 'DH', color: '#1a7a5e', bg: '#d0ede6' },
];

export default function GuildsSidebar({ activeCommunityId, onSelectCommunity }: Props): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div style={styles.sidebar}>
      {DEMO_COMMUNITIES.map((c) => (
        <button
          key={c.id}
          title={c.id}
          onClick={() => onSelectCommunity(c.id)}
          style={{
            ...styles.icon,
            background: c.bg,
            color: c.color,
            borderRadius: activeCommunityId === c.id ? '14px' : '50%',
            border: activeCommunityId === c.id ? `2px solid var(--color-accent)` : '2px solid transparent',
          }}
        >
          {c.initials}
        </button>
      ))}

      <div style={styles.divider} />

      <button
        title={t('nav.addCommunity')}
        style={{ ...styles.icon, background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', fontSize: '22px', fontWeight: 300 }}
      >
        +
      </button>
    </div>
  );
}

const styles = {
  sidebar: {
    width: 'var(--sidebar-guilds-w)',
    background: 'var(--color-bg-tertiary)',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '10px 0',
    gap: '6px',
    borderRight: '1px solid var(--color-border)',
    flexShrink: 0,
  } as React.CSSProperties,
  icon: {
    width: '44px',
    height: '44px',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 700,
    transition: 'border-radius 0.2s, border-color 0.2s',
  } as React.CSSProperties,
  divider: {
    width: '32px',
    height: '1px',
    background: 'var(--color-border)',
    margin: '2px 0',
  } as React.CSSProperties,
} as const;
