import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNetworkStore } from '../stores/networkStore.js';

export default function NetworkStatusBar(): React.JSX.Element | null {
  const { t } = useTranslation();
  const { status, peerCount, peerId } = useNetworkStore();

  if (status === 'connected') return null; // Hide when all is good

  const color = status === 'connecting' ? 'var(--color-amber)' : 'var(--color-red)';
  const label = status === 'connecting' ? t('network.connecting') : t('network.disconnected');

  return (
    <div style={{ ...styles.bar, background: color === 'var(--color-amber)' ? 'rgba(245,166,35,0.12)' : 'rgba(240,96,96,0.12)', borderBottom: `1px solid ${color}` }}>
      <span style={{ ...styles.dot, background: color }} />
      <span style={{ fontSize: '12px', color }}>{label}</span>
    </div>
  );
}

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 16px',
    flexShrink: 0,
  } as React.CSSProperties,
  dot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    flexShrink: 0,
  } as React.CSSProperties,
} as const;
