/**
 * NodeSettings — R20
 *
 * UI for managing relay nodes: view connected node, add/remove nodes,
 * see stability ranking, manually connect to a specific node.
 *
 * Can be rendered inside a settings panel or as a standalone modal.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNodeDiscovery, KnownNode } from '../stores/nodeDiscovery.js';
import { useNetworkStore } from '../stores/networkStore.js';

export default function NodeSettings(): React.JSX.Element {
  const { t } = useTranslation();
  const { nodes, addManualNode, removeNode } = useNodeDiscovery();
  const { status, connectedNodeUrl, fallbackActive, disconnect, connect } = useNetworkStore();
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const handleAdd = () => {
    const url = newUrl.trim();
    if (!url) return;
    addManualNode(url, newName.trim() || undefined);
    setNewUrl('');
    setNewName('');
    setShowAdd(false);
  };

  const handleReconnect = () => {
    disconnect();
    setTimeout(() => connect(), 500);
  };

  return (
    <div style={s.container}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.headerIcon}>{'\u{1F310}'}</span>
        <span style={s.headerTitle}>{t('nodes.title')}</span>
      </div>

      {/* Connection status */}
      <div style={s.statusBar}>
        <div style={s.statusRow}>
          <span style={s.statusLabel}>{t('nodes.status')}:</span>
          <span style={{
            ...s.statusValue,
            color: status === 'connected' ? '#43B581' : status === 'connecting' ? '#EF9F27' : '#E24B4A',
          }}>
            {status === 'connected' ? `\u{2705} ${t('nodes.connected')}` :
             status === 'connecting' ? `\u{23F3} ${t('nodes.connecting')}` :
             status === 'authenticating' ? `\u{1F510} ${t('nodes.authenticating')}` :
             `\u{274C} ${t('nodes.disconnected')}`}
          </span>
        </div>
        {connectedNodeUrl && status === 'connected' && (
          <div style={s.statusRow}>
            <span style={s.statusLabel}>{t('nodes.node')}:</span>
            <span style={s.statusValue}>{connectedNodeUrl}</span>
          </div>
        )}
        {fallbackActive && (
          <div style={s.fallbackBanner}>
            {'\u{1F504}'} {t('nodes.tryingAlternatives')}
          </div>
        )}
        <button onClick={handleReconnect} style={s.reconnectBtn}>
          {'\u{1F504}'} {t('nodes.reconnect')}
        </button>
      </div>

      {/* Node list */}
      <div style={s.section}>
        <div style={s.sectionHeader}>
          <span style={s.sectionTitle}>{t('nodes.known', { count: nodes.length })}</span>
          <button onClick={() => setShowAdd(!showAdd)} style={s.addBtn}>
            {showAdd ? t('nodes.cancel') : `+ ${t('nodes.addNode')}`}
          </button>
        </div>

        {/* Add node form */}
        {showAdd && (
          <div style={s.addForm}>
            <input
              type="text"
              placeholder={t('nodes.urlPlaceholder')}
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              style={s.input}
              autoFocus
            />
            <input
              type="text"
              placeholder={t('nodes.namePlaceholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              style={s.input}
            />
            <button onClick={handleAdd} disabled={!newUrl.trim()} style={s.saveBtn}>
              {t('nodes.add')}
            </button>
          </div>
        )}

        {/* Nodes */}
        <div style={s.nodeList}>
          {nodes.map((node) => (
            <NodeRow
              key={node.url}
              node={node}
              isConnected={node.url === connectedNodeUrl && status === 'connected'}
              onRemove={() => removeNode(node.url)}
            />
          ))}
          {nodes.length === 0 && (
            <p style={s.emptyText}>{t('nodes.empty')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// =================================================================
// Node row subcomponent
// =================================================================

function NodeRow({ node, isConnected, onRemove }: { node: KnownNode; isConnected: boolean; onRemove: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  const lastSeen = node.lastConnected ? timeAgo(node.lastConnected, t) : t('nodes.never');
  const tags: string[] = [];
  if (node.seed) tags.push('SEED');
  if (node.manual) tags.push('MANUAL');
  if (isConnected) tags.push('ACTIVE');

  return (
    <div style={{ ...s.nodeRow, borderColor: isConnected ? '#43B581' : 'var(--color-border)' }}>
      <div style={s.nodeMain}>
        <div style={s.nodeName}>
          {isConnected && <span style={s.activeDot} />}
          {node.name || node.url}
        </div>
        <div style={s.nodeUrl}>{node.url}</div>
        <div style={s.nodeMeta}>
          {tags.map((t) => (
            <span key={t} style={{
              ...s.tag,
              background: t === 'ACTIVE' ? '#43B581' : t === 'SEED' ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
              color: t === 'ACTIVE' || t === 'SEED' ? '#fff' : 'var(--color-text-muted)',
            }}>{t}</span>
          ))}
          {node.uptimePercent > 0 && (
            <span style={s.metaText}>{t('nodes.uptime', { percent: node.uptimePercent.toFixed(0) })}</span>
          )}
          {node.activeDays > 0 && (
            <span style={s.metaText}>{t('nodes.daysActive', { count: node.activeDays })}</span>
          )}
          <span style={s.metaText}>{t('nodes.last', { when: lastSeen })}</span>
          <span style={s.metaText}>{t('nodes.okFail', { ok: node.connectCount, fail: node.failCount })}</span>
        </div>
      </div>
      {!node.seed && (
        <button onClick={onRemove} style={s.removeBtn} title={t('nodes.removeNode')}>
          {'\u{2716}'}
        </button>
      )}
    </div>
  );
}

function timeAgo(ts: number, t: (k: string, o?: any) => string): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return t('nodes.justNow');
  if (diff < 3600000) return t('nodes.minutesAgo', { count: Math.floor(diff / 60000) });
  if (diff < 86400000) return t('nodes.hoursAgo', { count: Math.floor(diff / 3600000) });
  return t('nodes.daysAgo', { count: Math.floor(diff / 86400000) });
}

// =================================================================
// Styles
// =================================================================

const s = {
  container: { display: 'flex', flexDirection: 'column' as const, height: '100%', background: 'var(--color-bg-primary)' } as React.CSSProperties,
  header: { display: 'flex', alignItems: 'center', gap: '8px', padding: '16px 20px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 } as React.CSSProperties,
  headerIcon: { fontSize: '18px' } as React.CSSProperties,
  headerTitle: { fontSize: '16px', fontWeight: 700 } as React.CSSProperties,
  statusBar: { padding: '12px 20px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' } as React.CSSProperties,
  statusRow: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', fontSize: '13px' } as React.CSSProperties,
  statusLabel: { color: 'var(--color-text-muted)', minWidth: '50px' } as React.CSSProperties,
  statusValue: { fontWeight: 500 } as React.CSSProperties,
  fallbackBanner: { fontSize: '12px', color: '#EF9F27', padding: '6px 0', fontWeight: 500 } as React.CSSProperties,
  reconnectBtn: { marginTop: '8px', padding: '6px 16px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: '12px', cursor: 'pointer' } as React.CSSProperties,
  section: { flex: 1, overflow: 'auto', padding: '16px 20px' } as React.CSSProperties,
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' } as React.CSSProperties,
  sectionTitle: { fontSize: '13px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' } as React.CSSProperties,
  addBtn: { padding: '4px 12px', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--color-accent)', fontSize: '12px', fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  addForm: { display: 'flex', flexDirection: 'column' as const, gap: '8px', padding: '12px', marginBottom: '12px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' } as React.CSSProperties,
  input: { padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontSize: '13px', outline: 'none' } as React.CSSProperties,
  saveBtn: { padding: '8px 16px', border: 'none', borderRadius: 'var(--radius-md)', background: '#43B581', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' as const } as React.CSSProperties,
  nodeList: { display: 'flex', flexDirection: 'column' as const, gap: '8px' } as React.CSSProperties,
  emptyText: { fontSize: '13px', color: 'var(--color-text-muted)', textAlign: 'center' as const, padding: '24px 0' } as React.CSSProperties,
  nodeRow: { display: 'flex', alignItems: 'center', padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' } as React.CSSProperties,
  nodeMain: { flex: 1, minWidth: 0 } as React.CSSProperties,
  nodeName: { fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' } as React.CSSProperties,
  activeDot: { width: '8px', height: '8px', borderRadius: '50%', background: '#43B581', flexShrink: 0 } as React.CSSProperties,
  nodeUrl: { fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } as React.CSSProperties,
  nodeMeta: { display: 'flex', flexWrap: 'wrap' as const, gap: '6px', marginTop: '6px', alignItems: 'center' } as React.CSSProperties,
  tag: { fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '3px', letterSpacing: '0.05em' } as React.CSSProperties,
  metaText: { fontSize: '11px', color: 'var(--color-text-muted)' } as React.CSSProperties,
  removeBtn: { padding: '4px 8px', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', fontSize: '14px', cursor: 'pointer', flexShrink: 0, opacity: 0.6 } as React.CSSProperties,
} as const;
