/**
 * SettingsPanel — R24 update
 *
 * Added Network/NAT tab.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiNav } from '../stores/uiNavStore.js';
import NodeSettings from './NodeSettings.js';
import StorageSettings from './StorageSettings.js';
import ClientNodeSettings from './ClientNodeSettings.js';
import NatSettings from './NatSettings.js';
import GeneralSettings from './GeneralSettings.js';

type SettingsTab = 'general' | 'nodes' | 'storage' | 'client-node' | 'network';

const TABS: Array<{ id: SettingsTab; icon: string; labelKey: string }> = [
  { id: 'general', icon: '\u{1F310}', labelKey: 'settings.general' },
  { id: 'nodes', icon: '\u{1F517}', labelKey: 'settings.nodes' },
  { id: 'storage', icon: '\u{1F4BE}', labelKey: 'settings.storage' },
  { id: 'client-node', icon: '\u{1F5A5}\u{FE0F}', labelKey: 'settings.clientNode' },
  { id: 'network', icon: '\u{1F30D}', labelKey: 'settings.network' },
];

export default function SettingsPanel(): React.JSX.Element {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const close = (): void => useUiNav.getState().requestCloseSettings();

  // Esc closes settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div style={s.container}>
      <button onClick={close} style={s.closeBtn} title="Close settings (Esc)">{'✕'}</button>
      {/* Sidebar with tabs */}
      <div style={s.sidebar}>
        <div style={s.sidebarTitle}>{t('settings.title')}</div>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...s.tabBtn,
              background: activeTab === tab.id ? 'var(--color-bg-hover)' : 'transparent',
              color: activeTab === tab.id ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
            }}
          >
            <span style={s.tabIcon}>{tab.icon}</span>
            <span>{t(tab.labelKey)}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={s.content}>
        {activeTab === 'general' && <GeneralSettings />}
        {activeTab === 'nodes' && <NodeSettings />}
        {activeTab === 'storage' && <StorageSettings />}
        {activeTab === 'client-node' && <ClientNodeSettings />}
        {activeTab === 'network' && <NatSettings />}
      </div>
    </div>
  );
}

const s = {
  container: { position: 'relative' as const, display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' } as React.CSSProperties,
  closeBtn: { position: 'absolute' as const, top: '10px', right: '12px', width: '32px', height: '32px', borderRadius: '8px', background: 'var(--color-bg-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20 } as React.CSSProperties,
  sidebar: { width: '180px', background: 'var(--color-bg-secondary)', borderRight: '1px solid var(--color-border)', padding: '16px 0', flexShrink: 0, overflow: 'auto' } as React.CSSProperties,
  sidebarTitle: { fontSize: '12px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', padding: '0 16px 12px', borderBottom: '1px solid var(--color-border)', marginBottom: '8px' } as React.CSSProperties,
  tabBtn: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 500, textAlign: 'left' as const, borderRadius: 0 } as React.CSSProperties,
  tabIcon: { fontSize: '16px', flexShrink: 0 } as React.CSSProperties,
  content: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' as const } as React.CSSProperties,
} as const;
