/**
 * NatSettings — R24
 *
 * Shows NAT detection results, TURN server configuration,
 * port reachability check, and relay proxy status.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNatStore, NatType, TurnServer } from '../stores/natStore.js';
import { useClientNodeStore } from '../stores/clientNodeStore.js';

const NAT_INFO: Record<NatType, { icon: string; label: string; color: string; desc: string }> = {
  open: { icon: '\u{2705}', label: 'nat.open', color: '#43B581', desc: 'nat.openDesc' },
  full_cone: { icon: '\u{1F7E1}', label: 'nat.fullCone', color: '#EF9F27', desc: 'nat.fullConeDesc' },
  symmetric: { icon: '\u{1F7E0}', label: 'nat.symmetric', color: '#E67E22', desc: 'nat.symmetricDesc' },
  restricted: { icon: '\u{1F534}', label: 'nat.restricted', color: '#E24B4A', desc: 'nat.restrictedDesc' },
  unknown: { icon: '\u{2753}', label: 'nat.unknown', color: 'var(--color-text-muted)', desc: 'nat.unknownDesc' },
};

export default function NatSettings(): React.JSX.Element {
  const { t } = useTranslation();
  const { natType, detecting, publicIp, localIp, relayProxyActive, proxyNodeUrl, turnServers, portReachable, detectNat, checkPortReachable, addTurnServer, removeTurnServer } = useNatStore();
  const { config: nodeConfig } = useClientNodeStore();
  const [showTurnForm, setShowTurnForm] = useState(false);
  const [turnUrl, setTurnUrl] = useState('');
  const [turnUser, setTurnUser] = useState('');
  const [turnCred, setTurnCred] = useState('');

  const info = NAT_INFO[natType];

  const handleAddTurn = () => {
    if (!turnUrl.trim()) return;
    addTurnServer({ urls: turnUrl.trim(), username: turnUser.trim() || undefined, credential: turnCred.trim() || undefined });
    setTurnUrl(''); setTurnUser(''); setTurnCred('');
    setShowTurnForm(false);
  };

  return (
    <div style={s.container}>
      <div style={s.header}>
        <span style={s.headerIcon}>{'\u{1F30D}'}</span>
        <span style={s.headerTitle}>{t('nat.title')}</span>
      </div>

      <div style={s.scrollArea}>
        {/* NAT Detection */}
        <div style={s.section}>
          <div style={s.sectionTitle}>{t('nat.natType')}</div>
          <div style={{ ...s.natCard, borderColor: info.color }}>
            <div style={s.natHeader}>
              <span style={s.natIcon}>{info.icon}</span>
              <span style={{ ...s.natLabel, color: info.color }}>{t(info.label)}</span>
            </div>
            <div style={s.natDesc}>{t(info.desc)}</div>
            {publicIp && (
              <div style={s.ipRow}>
                <span style={s.ipLabel}>{t('nat.publicIp')}</span>
                <span style={s.ipValue}>{publicIp}</span>
              </div>
            )}
            {localIp && (
              <div style={s.ipRow}>
                <span style={s.ipLabel}>{t('nat.localIp')}</span>
                <span style={s.ipValue}>{localIp}</span>
              </div>
            )}
          </div>
          <button onClick={detectNat} disabled={detecting} style={s.detectBtn}>
            {detecting ? `\u{23F3} ${t('nat.detecting')}` : `\u{1F50D} ${t('nat.detect')}`}
          </button>
        </div>

        {/* Port Reachability */}
        <div style={s.section}>
          <div style={s.sectionTitle}>{t('nat.portReachability')}</div>
          <div style={s.portRow}>
            <span style={s.portLabel}>{t('nat.port', { port: nodeConfig.port })}</span>
            <span style={{ ...s.portStatus, color: portReachable === true ? '#43B581' : portReachable === false ? '#E24B4A' : 'var(--color-text-muted)' }}>
              {portReachable === true ? `\u{2705} ${t('nat.reachable')}` : portReachable === false ? `\u{274C} ${t('nat.notReachable')}` : `\u{2753} ${t('nat.notChecked')}`}
            </span>
            <button onClick={() => checkPortReachable(nodeConfig.port)} style={s.checkBtn}>{t('nat.check')}</button>
          </div>
          {portReachable === false && (
            <div style={s.helpText}>
              {t('nat.portHelp', { port: nodeConfig.port })}
            </div>
          )}
        </div>

        {/* Relay Proxy Status */}
        <div style={s.section}>
          <div style={s.sectionTitle}>{t('nat.relayProxy')}</div>
          <div style={s.proxyCard}>
            <div style={s.proxyRow}>
              <span style={s.proxyLabel}>{t('nodes.status')}:</span>
              <span style={{ color: relayProxyActive ? '#EF9F27' : '#43B581', fontWeight: 500, fontSize: '13px' }}>
                {relayProxyActive ? `\u{1F504} ${t('nat.proxyActive')}` : `\u{2705} ${t('nat.proxyDirect')}`}
              </span>
            </div>
            {relayProxyActive && proxyNodeUrl && (
              <div style={s.proxyRow}>
                <span style={s.proxyLabel}>{t('nat.proxy')}</span>
                <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{proxyNodeUrl}</span>
              </div>
            )}
            <div style={s.proxyDesc}>
              {relayProxyActive ? t('nat.proxyDescActive') : t('nat.proxyDescDirect')}
            </div>
          </div>
        </div>

        {/* TURN Servers */}
        <div style={s.section}>
          <div style={s.sectionHeaderRow}>
            <div style={s.sectionTitle}>{t('nat.turnServers')}</div>
            <button onClick={() => setShowTurnForm(!showTurnForm)} style={s.addBtn}>
              {showTurnForm ? t('nodes.cancel') : `+ ${t('nat.addTurn')}`}
            </button>
          </div>
          <div style={s.turnDesc}>
            {t('nat.turnDesc')}
          </div>

          {showTurnForm && (
            <div style={s.turnForm}>
              <input type="text" placeholder={t('nat.turnUrlPlaceholder')} value={turnUrl} onChange={(e) => setTurnUrl(e.target.value)} style={s.input} autoFocus />
              <input type="text" placeholder={t('nat.turnUserPlaceholder')} value={turnUser} onChange={(e) => setTurnUser(e.target.value)} style={s.input} />
              <input type="password" placeholder={t('nat.turnCredPlaceholder')} value={turnCred} onChange={(e) => setTurnCred(e.target.value)} style={s.input} />
              <button onClick={handleAddTurn} disabled={!turnUrl.trim()} style={s.saveBtn}>{t('nodes.add')}</button>
            </div>
          )}

          {/* Default STUN servers (always present) */}
          <div style={s.serverList}>
            <div style={s.serverRow}>
              <span style={s.serverIcon}>{'\u{1F7E2}'}</span>
              <div style={s.serverInfo}>
                <div style={s.serverUrl}>stun:stun.l.google.com:19302</div>
                <div style={s.serverTag}>STUN \u2022 {t('nat.builtIn')}</div>
              </div>
            </div>

            {turnServers.map((srv) => (
              <div key={srv.urls} style={s.serverRow}>
                <span style={s.serverIcon}>{'\u{1F535}'}</span>
                <div style={s.serverInfo}>
                  <div style={s.serverUrl}>{srv.urls}</div>
                  <div style={s.serverTag}>TURN {srv.username ? `\u2022 ${srv.username}` : ''}</div>
                </div>
                <button onClick={() => removeTurnServer(srv.urls)} style={s.removeBtn}>{'\u{2716}'}</button>
              </div>
            ))}
          </div>

          {turnServers.length === 0 && (
            <div style={s.noTurnHint}>
              {t('nat.noTurn')}
            </div>
          )}
        </div>

        {/* Quick guide */}
        <div style={s.section}>
          <div style={s.sectionTitle}>{t('nat.guide')}</div>
          <div style={s.guideCard}>
            <div style={s.guideRow}>{'\u{2705}'} <strong>Open / Full Cone:</strong> {t('nat.openDesc')}</div>
            <div style={s.guideRow}>{'\u{1F7E0}'} <strong>{t('nat.symmetric')}:</strong> {t('nat.symmetricDesc')}</div>
            <div style={s.guideRow}>{'\u{1F534}'} <strong>{t('nat.restricted')}:</strong> {t('nat.restrictedDesc')}</div>
            <div style={s.guideRow}>{'\u{1F512}'} <strong>E2E:</strong> {t('nat.proxyDescActive')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const s = {
  container: { display: 'flex', flexDirection: 'column' as const, height: '100%', background: 'var(--color-bg-primary)' } as React.CSSProperties,
  header: { display: 'flex', alignItems: 'center', gap: '8px', padding: '16px 20px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 } as React.CSSProperties,
  headerIcon: { fontSize: '18px' } as React.CSSProperties,
  headerTitle: { fontSize: '16px', fontWeight: 700 } as React.CSSProperties,
  scrollArea: { flex: 1, overflow: 'auto', padding: '0 20px 20px' } as React.CSSProperties,
  section: { marginTop: '20px' } as React.CSSProperties,
  sectionTitle: { fontSize: '12px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '8px' } as React.CSSProperties,
  sectionHeaderRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } as React.CSSProperties,
  natCard: { padding: '14px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', border: '2px solid var(--color-border)' } as React.CSSProperties,
  natHeader: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' } as React.CSSProperties,
  natIcon: { fontSize: '20px' } as React.CSSProperties,
  natLabel: { fontSize: '16px', fontWeight: 700 } as React.CSSProperties,
  natDesc: { fontSize: '12px', color: 'var(--color-text-muted)', lineHeight: 1.5, marginBottom: '8px' } as React.CSSProperties,
  ipRow: { display: 'flex', gap: '8px', fontSize: '12px', marginTop: '4px' } as React.CSSProperties,
  ipLabel: { color: 'var(--color-text-muted)', minWidth: '70px' } as React.CSSProperties,
  ipValue: { fontFamily: 'monospace', color: 'var(--color-text-primary)' } as React.CSSProperties,
  detectBtn: { marginTop: '10px', padding: '8px 20px', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--color-accent)', fontSize: '13px', fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  portRow: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' } as React.CSSProperties,
  portLabel: { color: 'var(--color-text-muted)' } as React.CSSProperties,
  portStatus: { fontWeight: 500, flex: 1 } as React.CSSProperties,
  checkBtn: { padding: '4px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: '12px', cursor: 'pointer' } as React.CSSProperties,
  helpText: { marginTop: '8px', fontSize: '12px', color: 'var(--color-text-muted)', lineHeight: 1.5, padding: '8px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' } as React.CSSProperties,
  proxyCard: { padding: '12px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' } as React.CSSProperties,
  proxyRow: { display: 'flex', gap: '8px', marginBottom: '4px' } as React.CSSProperties,
  proxyLabel: { fontSize: '12px', color: 'var(--color-text-muted)', minWidth: '50px' } as React.CSSProperties,
  proxyDesc: { fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '6px', lineHeight: 1.4 } as React.CSSProperties,
  addBtn: { padding: '4px 10px', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--color-accent)', fontSize: '11px', fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  turnDesc: { fontSize: '12px', color: 'var(--color-text-muted)', lineHeight: 1.4, marginBottom: '8px' } as React.CSSProperties,
  turnForm: { display: 'flex', flexDirection: 'column' as const, gap: '6px', padding: '12px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', marginBottom: '8px' } as React.CSSProperties,
  input: { padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontSize: '13px' } as React.CSSProperties,
  saveBtn: { padding: '6px 16px', border: 'none', borderRadius: 'var(--radius-md)', background: '#43B581', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' as const } as React.CSSProperties,
  serverList: { display: 'flex', flexDirection: 'column' as const, gap: '4px' } as React.CSSProperties,
  serverRow: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' } as React.CSSProperties,
  serverIcon: { fontSize: '12px', flexShrink: 0 } as React.CSSProperties,
  serverInfo: { flex: 1 } as React.CSSProperties,
  serverUrl: { fontSize: '12px', fontFamily: 'monospace' } as React.CSSProperties,
  serverTag: { fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '2px' } as React.CSSProperties,
  removeBtn: { padding: '2px 6px', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', fontSize: '12px', cursor: 'pointer' } as React.CSSProperties,
  noTurnHint: { fontSize: '12px', color: 'var(--color-text-muted)', padding: '8px 0', lineHeight: 1.4 } as React.CSSProperties,
  guideCard: { padding: '12px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' as const, gap: '6px' } as React.CSSProperties,
  guideRow: { fontSize: '12px', color: 'var(--color-text-secondary)', lineHeight: 1.5 } as React.CSSProperties,
} as const;
