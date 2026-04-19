/**
 * SettingsPanel — R24 update
 *
 * Added Network/NAT tab.
 */

import React, { useState } from 'react';
import NodeSettings from './NodeSettings.js';
import StorageSettings from './StorageSettings.js';
import ClientNodeSettings from './ClientNodeSettings.js';
import NatSettings from './NatSettings.js';

type SettingsTab = 'nodes' | 'storage' | 'client-node' | 'network';

const TABS: Array<{ id: SettingsTab; icon: string; label: string }> = [
  { id: 'nodes', icon: '\u{1F310}', label: 'Nodes' },
  { id: 'storage', icon: '\u{1F4BE}', label: 'Storage' },
  { id: 'client-node', icon: '\u{1F5A5}\u{FE0F}', label: 'Client Node' },
  { id: 'network', icon: '\u{1F30D}', label: 'Network' },
];

export default function SettingsPanel(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<SettingsTab>('nodes');

  return (
    <div style={s.container}>
      {/* Sidebar with tabs */}
      <div style={s.sidebar}>
        <div style={s.sidebarTitle}>Settings</div>
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
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={s.content}>
        {activeTab === 'nodes' && <NodeSettings />}
        {activeTab === 'storage' && <StorageSettings />}
        {activeTab === 'client-node' && <ClientNodeSettings />}
        {activeTab === 'network' && <NatSettings />}
      </div>
    </div>
  );
}

const s = {
  container: { display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' } as React.CSSProperties,
  sidebar: { width: '180px', background: 'var(--color-bg-secondary)', borderRight: '1px solid var(--color-border)', padding: '16px 0', flexShrink: 0, overflow: 'auto' } as React.CSSProperties,
  sidebarTitle: { fontSize: '12px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', padding: '0 16px 12px', borderBottom: '1px solid var(--color-border)', marginBottom: '8px' } as React.CSSProperties,
  tabBtn: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 500, textAlign: 'left' as const, borderRadius: 0 } as React.CSSProperties,
  tabIcon: { fontSize: '16px', flexShrink: 0 } as React.CSSProperties,
  content: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' as const } as React.CSSProperties,
} as const;
