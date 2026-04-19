/**
 * ClientNodeSettings — R23
 *
 * UI for enabling/disabling the embedded relay node.
 * Only available in the Tauri desktop app.
 */

import React, { useState } from 'react';
import { useClientNodeStore, NodeMode } from '../stores/clientNodeStore.js';
import { useCommunityStore } from '../stores/communityStore.js';

const MODE_INFO: Record<NodeMode, { icon: string; label: string; desc: string }> = {
  off: { icon: '\u{26AA}', label: 'Off', desc: 'No local relay. You connect to remote nodes only.' },
  temp: { icon: '\u{1F310}', label: 'Temp Node', desc: 'Contribute 10% passively while active. 30-day data retention. Helps the network without hosting communities.' },
  client: { icon: '\u{1F4BB}', label: 'Client Node', desc: 'Host your communities permanently on this PC. Acts as a mini server for your squads and community groups.' },
};

export default function ClientNodeSettings(): React.JSX.Element {
  const { config, running, pid, logs, error, uptimeSeconds, start, stop, setMode, setPort, setMaxDisk, setMaxBandwidth, setAutoStart, setRelayPath, hostCommunity, unhostCommunity, clearLogs } = useClientNodeStore();
  const { communities } = useCommunityStore();
  const [showLogs, setShowLogs] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const communityList = Object.values(communities);
  const hostedSet = new Set(config.hostedCommunityIds);

  const uptimeStr = uptimeSeconds > 0
    ? `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s`
    : '—';

  return (
    <div style={s.container}>
      <div style={s.header}>
        <span style={s.headerIcon}>{'\u{1F5A5}\u{FE0F}'}</span>
        <span style={s.headerTitle}>Client Node</span>
        {running && <span style={s.runningBadge}>RUNNING</span>}
      </div>

      <div style={s.scrollArea}>
        {/* Status bar */}
        <div style={s.section}>
          <div style={s.statusCard}>
            <div style={s.statusRow}>
              <span style={s.statusLabel}>Status:</span>
              <span style={{ ...s.statusValue, color: running ? '#43B581' : 'var(--color-text-muted)' }}>
                {running ? `\u{2705} Running (PID ${pid})` : '\u{26AA} Stopped'}
              </span>
            </div>
            {running && (
              <>
                <div style={s.statusRow}>
                  <span style={s.statusLabel}>Uptime:</span>
                  <span style={s.statusValue}>{uptimeStr}</span>
                </div>
                <div style={s.statusRow}>
                  <span style={s.statusLabel}>Port:</span>
                  <span style={s.statusValue}>{config.port}</span>
                </div>
                <div style={s.statusRow}>
                  <span style={s.statusLabel}>Mode:</span>
                  <span style={s.statusValue}>{MODE_INFO[config.mode]?.label}</span>
                </div>
              </>
            )}
          </div>

          {error && <div style={s.errorBar}>{error}</div>}

          {/* Start/Stop button */}
          <div style={s.btnRow}>
            {!running ? (
              <button onClick={start} disabled={config.mode === 'off'} style={{ ...s.startBtn, opacity: config.mode === 'off' ? 0.5 : 1 }}>
                {'\u{25B6}\u{FE0F}'} Start Node
              </button>
            ) : (
              <button onClick={stop} style={s.stopBtn}>
                {'\u{23F9}\u{FE0F}'} Stop Node
              </button>
            )}
          </div>
        </div>

        {/* Mode selection */}
        <div style={s.section}>
          <div style={s.sectionTitle}>Node Mode</div>
          <div style={s.modeList}>
            {(Object.entries(MODE_INFO) as [NodeMode, typeof MODE_INFO['off']][]).map(([mode, info]) => (
              <button
                key={mode}
                onClick={() => setMode(mode)}
                disabled={running}
                style={{
                  ...s.modeBtn,
                  borderColor: config.mode === mode ? 'var(--color-accent)' : 'var(--color-border)',
                  background: config.mode === mode ? 'var(--color-accent-dim, rgba(46,117,182,0.1))' : 'var(--color-bg-secondary)',
                  opacity: running ? 0.6 : 1,
                }}
              >
                <span style={s.modeIcon}>{info.icon}</span>
                <div>
                  <div style={s.modeLabel}>{info.label}</div>
                  <div style={s.modeDesc}>{info.desc}</div>
                </div>
              </button>
            ))}
          </div>
          {config.mode !== 'off' && (
            <div style={s.modeWarning}>
              {config.mode === 'client'
                ? '\u{2139}\u{FE0F} Disabling Client Node keeps your communities active on the network, but content only persists 30 days without a host.'
                : '\u{2139}\u{FE0F} Temp Node contributes passively while you use the app. No permanent hosting.'}
            </div>
          )}
        </div>

        {/* Community hosting (client mode only) */}
        {config.mode === 'client' && (
          <div style={s.section}>
            <div style={s.sectionTitle}>Hosted Communities</div>
            <div style={s.hostDesc}>
              Select which communities to permanently host on this node. Hosted communities retain data even when you're offline.
            </div>
            <div style={s.communityList}>
              {communityList.map((c) => (
                <label key={c.id} style={s.communityRow}>
                  <input
                    type="checkbox"
                    checked={hostedSet.has(c.id)}
                    onChange={(e) => e.target.checked ? hostCommunity(c.id) : unhostCommunity(c.id)}
                    disabled={running}
                    style={s.checkbox}
                  />
                  <span style={s.communityName}>{c.name}</span>
                  {hostedSet.has(c.id) && <span style={s.hostedBadge}>HOSTED</span>}
                </label>
              ))}
              {communityList.length === 0 && (
                <div style={s.emptyText}>No communities joined yet.</div>
              )}
            </div>
          </div>
        )}

        {/* Resource limits */}
        {config.mode !== 'off' && (
          <div style={s.section}>
            <div style={s.sectionTitle}>Resource Limits</div>
            <div style={s.limitRow}>
              <span style={s.limitLabel}>Port:</span>
              <input type="number" value={config.port} onChange={(e) => setPort(parseInt(e.target.value) || 4003)} disabled={running} style={s.limitInput} />
            </div>
            <div style={s.limitRow}>
              <span style={s.limitLabel}>Max disk:</span>
              <input type="number" value={config.maxDiskMB} onChange={(e) => setMaxDisk(parseInt(e.target.value) || 2048)} disabled={running} style={s.limitInput} />
              <span style={s.limitSuffix}>MB</span>
            </div>
            <div style={s.limitRow}>
              <span style={s.limitLabel}>Max bandwidth:</span>
              <input type="number" value={config.maxBandwidthMBPerDay} onChange={(e) => setMaxBandwidth(parseInt(e.target.value) || 512)} disabled={running} style={s.limitInput} />
              <span style={s.limitSuffix}>MB/day</span>
            </div>
            <label style={s.checkRow}>
              <input type="checkbox" checked={config.autoStart} onChange={(e) => setAutoStart(e.target.checked)} style={s.checkbox} />
              <span>Auto-start on app launch</span>
            </label>
          </div>
        )}

        {/* Advanced */}
        <div style={s.section}>
          <button onClick={() => setShowAdvanced(!showAdvanced)} style={s.toggleBtn}>
            {showAdvanced ? '\u{25BC}' : '\u{25B6}'} Advanced
          </button>
          {showAdvanced && (
            <div style={s.advancedPanel}>
              <div style={s.limitRow}>
                <span style={s.limitLabel}>Relay path:</span>
                <input
                  type="text"
                  value={config.relayPath}
                  onChange={(e) => setRelayPath(e.target.value)}
                  placeholder="apps/relay/dist/index.js (auto)"
                  disabled={running}
                  style={{ ...s.limitInput, flex: 1 }}
                />
              </div>
              <div style={s.advancedNote}>
                Leave empty for auto-detection. Set manually if the relay is at a custom path.
              </div>
            </div>
          )}
        </div>

        {/* Logs */}
        <div style={s.section}>
          <div style={s.sectionHeaderRow}>
            <button onClick={() => setShowLogs(!showLogs)} style={s.toggleBtn}>
              {showLogs ? '\u{25BC}' : '\u{25B6}'} Logs ({logs.length})
            </button>
            {showLogs && logs.length > 0 && (
              <button onClick={clearLogs} style={s.clearBtn}>Clear</button>
            )}
          </div>
          {showLogs && (
            <div style={s.logPanel}>
              {logs.length === 0 ? (
                <div style={s.emptyText}>No logs yet. Start the node to see output.</div>
              ) : (
                logs.map((line, i) => (
                  <div key={i} style={s.logLine}>{line}</div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const s = {
  container: { display: 'flex', flexDirection: 'column' as const, height: '100%', background: 'var(--color-bg-primary)' } as React.CSSProperties,
  header: { display: 'flex', alignItems: 'center', gap: '8px', padding: '16px 20px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 } as React.CSSProperties,
  headerIcon: { fontSize: '18px' } as React.CSSProperties,
  headerTitle: { fontSize: '16px', fontWeight: 700, flex: 1 } as React.CSSProperties,
  runningBadge: { fontSize: '10px', fontWeight: 700, color: '#fff', background: '#43B581', padding: '2px 8px', borderRadius: '4px' } as React.CSSProperties,
  scrollArea: { flex: 1, overflow: 'auto', padding: '0 20px 20px' } as React.CSSProperties,
  section: { marginTop: '20px' } as React.CSSProperties,
  sectionTitle: { fontSize: '12px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '8px' } as React.CSSProperties,
  sectionHeaderRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as React.CSSProperties,
  statusCard: { padding: '12px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' } as React.CSSProperties,
  statusRow: { display: 'flex', gap: '8px', marginBottom: '4px', fontSize: '13px' } as React.CSSProperties,
  statusLabel: { color: 'var(--color-text-muted)', minWidth: '60px' } as React.CSSProperties,
  statusValue: { fontWeight: 500 } as React.CSSProperties,
  errorBar: { marginTop: '8px', padding: '8px 12px', fontSize: '12px', color: '#E24B4A', background: 'rgba(226,75,74,0.1)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(226,75,74,0.3)' } as React.CSSProperties,
  btnRow: { marginTop: '12px', display: 'flex', gap: '8px' } as React.CSSProperties,
  startBtn: { padding: '10px 24px', border: 'none', borderRadius: 'var(--radius-md)', background: '#43B581', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  stopBtn: { padding: '10px 24px', border: '1px solid #E24B4A', borderRadius: 'var(--radius-md)', background: 'transparent', color: '#E24B4A', fontSize: '14px', fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  modeList: { display: 'flex', flexDirection: 'column' as const, gap: '8px' } as React.CSSProperties,
  modeBtn: { display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'left' as const, color: 'var(--color-text-primary)' } as React.CSSProperties,
  modeIcon: { fontSize: '24px', flexShrink: 0, marginTop: '2px' } as React.CSSProperties,
  modeLabel: { fontSize: '13px', fontWeight: 600 } as React.CSSProperties,
  modeDesc: { fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '2px', lineHeight: 1.4 } as React.CSSProperties,
  modeWarning: { marginTop: '8px', padding: '8px 12px', fontSize: '12px', color: 'var(--color-text-muted)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', lineHeight: 1.4 } as React.CSSProperties,
  hostDesc: { fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '8px', lineHeight: 1.4 } as React.CSSProperties,
  communityList: { display: 'flex', flexDirection: 'column' as const, gap: '4px' } as React.CSSProperties,
  communityRow: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: '13px' } as React.CSSProperties,
  checkbox: { accentColor: 'var(--color-accent)' } as React.CSSProperties,
  communityName: { flex: 1, fontWeight: 500 } as React.CSSProperties,
  hostedBadge: { fontSize: '9px', fontWeight: 700, color: '#43B581', padding: '1px 6px', border: '1px solid #43B581', borderRadius: '3px' } as React.CSSProperties,
  emptyText: { fontSize: '12px', color: 'var(--color-text-muted)', padding: '12px 0', textAlign: 'center' as const } as React.CSSProperties,
  limitRow: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '13px' } as React.CSSProperties,
  limitLabel: { color: 'var(--color-text-muted)', minWidth: '100px' } as React.CSSProperties,
  limitInput: { width: '100px', padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontSize: '13px' } as React.CSSProperties,
  limitSuffix: { fontSize: '12px', color: 'var(--color-text-muted)' } as React.CSSProperties,
  checkRow: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer', marginTop: '4px' } as React.CSSProperties,
  toggleBtn: { padding: '6px 0', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', textTransform: 'uppercase' as const, letterSpacing: '0.05em' } as React.CSSProperties,
  advancedPanel: { marginTop: '8px', padding: '12px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' } as React.CSSProperties,
  advancedNote: { fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' } as React.CSSProperties,
  clearBtn: { padding: '2px 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: '11px', cursor: 'pointer' } as React.CSSProperties,
  logPanel: { marginTop: '8px', maxHeight: '300px', overflow: 'auto', padding: '8px', background: '#1a1a2e', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontFamily: 'monospace' } as React.CSSProperties,
  logLine: { fontSize: '11px', color: '#a0a0c0', lineHeight: 1.6, wordBreak: 'break-all' as const } as React.CSSProperties,
} as const;
