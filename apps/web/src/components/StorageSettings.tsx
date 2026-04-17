/**
 * StorageSettings — R21
 *
 * UI for managing local data retention, like browser history settings.
 * Shows node tier, storage stats, and lets users configure retention.
 */

import React, { useEffect, useState } from 'react';
import { useStorageStore, RetentionMode, RetentionOverride } from '../stores/storageStore.js';
import { useCommunityStore } from '../stores/communityStore.js';

const MODE_LABELS: Record<RetentionMode, { label: string; desc: string }> = {
  keep_all: {
    label: 'Keep everything',
    desc: 'All messages, files, and history are kept permanently on this device.',
  },
  auto_purge: {
    label: 'Auto-clean',
    desc: 'Automatically remove cached data older than the set period.',
  },
  viewed_only: {
    label: 'Keep only viewed',
    desc: 'Only retain data from communities and channels you\'ve opened. Unviewed content is cleaned automatically.',
  },
};

const TIER_LABELS: Record<string, { icon: string; label: string; desc: string }> = {
  main: { icon: '\u{1F5A5}\u{FE0F}', label: 'Main Node', desc: 'Dedicated server — hosts communities permanently' },
  client: { icon: '\u{1F4BB}', label: 'Client Node', desc: 'Contributing user — hosts selected communities + squads' },
  temp: { icon: '\u{1F310}', label: 'Temp Node', desc: 'Regular user — 30-day retention, 10% passive network contribution' },
};

export default function StorageSettings(): React.JSX.Element {
  const { mode, purgeDays, overrides, stats, connectedNodeTier, setMode, setPurgeDays, addOverride, removeOverride, clearCache, requestStats } = useStorageStore();
  const { communities } = useCommunityStore();
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [selectedCommunity, setSelectedCommunity] = useState('');

  useEffect(() => { requestStats(); }, []);

  const tierInfo = TIER_LABELS[connectedNodeTier] || TIER_LABELS.temp;
  const communityList = Object.values(communities);

  return (
    <div style={s.container}>
      <div style={s.header}>
        <span style={s.headerIcon}>{'\u{1F4BE}'}</span>
        <span style={s.headerTitle}>Storage & Data</span>
      </div>

      <div style={s.scrollArea}>
        {/* Connected node tier */}
        {connectedNodeTier && (
          <div style={s.section}>
            <div style={s.sectionTitle}>Connected Node</div>
            <div style={s.tierCard}>
              <span style={s.tierIcon}>{tierInfo.icon}</span>
              <div style={s.tierInfo}>
                <div style={s.tierLabel}>{tierInfo.label}</div>
                <div style={s.tierDesc}>{tierInfo.desc}</div>
              </div>
            </div>
          </div>
        )}

        {/* Storage stats */}
        {stats && (
          <div style={s.section}>
            <div style={s.sectionTitle}>Storage Usage</div>
            <div style={s.statsGrid}>
              <StatBox label="Messages" value={formatNumber(stats.totalMessages)} />
              <StatBox label="DMs" value={formatNumber(stats.totalDMs)} />
              <StatBox label="Hosted" value={String(stats.hostedCommunities)} sub="communities" />
              <StatBox label="Cached" value={String(stats.cachedCommunities)} sub="communities" />
              <StatBox label="Retention" value={stats.retentionDays === 0 ? '\u221E' : `${stats.retentionDays}d`} />
            </div>
          </div>
        )}

        {/* Retention mode */}
        <div style={s.section}>
          <div style={s.sectionTitle}>Data Retention</div>
          <div style={s.modeList}>
            {(Object.entries(MODE_LABELS) as [RetentionMode, { label: string; desc: string }][]).map(([key, info]) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                style={{
                  ...s.modeBtn,
                  borderColor: mode === key ? 'var(--color-accent)' : 'var(--color-border)',
                  background: mode === key ? 'var(--color-accent-dim, rgba(46,117,182,0.1))' : 'var(--color-bg-secondary)',
                }}
              >
                <div style={s.modeRadio}>
                  <div style={{ ...s.modeRadioInner, background: mode === key ? 'var(--color-accent)' : 'transparent' }} />
                </div>
                <div>
                  <div style={s.modeLabel}>{info.label}</div>
                  <div style={s.modeDesc}>{info.desc}</div>
                </div>
              </button>
            ))}
          </div>

          {mode === 'auto_purge' && (
            <div style={s.purgeConfig}>
              <label style={s.inputLabel}>Clean data older than:</label>
              <div style={s.purgeRow}>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={purgeDays}
                  onChange={(e) => setPurgeDays(Math.max(1, parseInt(e.target.value) || 30))}
                  style={s.input}
                />
                <span style={s.inputSuffix}>days</span>
              </div>
            </div>
          )}
        </div>

        {/* Per-community overrides */}
        <div style={s.section}>
          <div style={s.sectionHeaderRow}>
            <div style={s.sectionTitle}>Community Overrides</div>
            <button onClick={() => setShowOverrideForm(!showOverrideForm)} style={s.addBtn}>
              {showOverrideForm ? 'Cancel' : '+ Override'}
            </button>
          </div>
          <div style={s.overrideDesc}>Set different retention rules for specific communities, squads, or DMs.</div>

          {showOverrideForm && (
            <div style={s.overrideForm}>
              <select
                value={selectedCommunity}
                onChange={(e) => setSelectedCommunity(e.target.value)}
                style={s.select}
              >
                <option value="">Select community...</option>
                {communityList.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {selectedCommunity && (
                <div style={s.overrideBtns}>
                  <button
                    onClick={() => {
                      const c = communities[selectedCommunity];
                      addOverride({ id: selectedCommunity, type: 'community', name: c?.name || '?', mode: 'keep', purgeDays: 0 });
                      setShowOverrideForm(false);
                      setSelectedCommunity('');
                    }}
                    style={{ ...s.overrideActionBtn, background: '#43B581' }}
                  >Keep Forever</button>
                  <button
                    onClick={() => {
                      const c = communities[selectedCommunity];
                      addOverride({ id: selectedCommunity, type: 'community', name: c?.name || '?', mode: 'purge', purgeDays: 7 });
                      setShowOverrideForm(false);
                      setSelectedCommunity('');
                    }}
                    style={{ ...s.overrideActionBtn, background: '#EF9F27' }}
                  >Auto-purge 7d</button>
                  <button
                    onClick={() => {
                      clearCache(selectedCommunity);
                      setShowOverrideForm(false);
                      setSelectedCommunity('');
                    }}
                    style={{ ...s.overrideActionBtn, background: '#E24B4A' }}
                  >Delete Now</button>
                </div>
              )}
            </div>
          )}

          {overrides.length > 0 && (
            <div style={s.overrideList}>
              {overrides.map((o) => (
                <div key={o.id} style={s.overrideRow}>
                  <div style={s.overrideName}>{o.name}</div>
                  <div style={s.overrideMode}>
                    {o.mode === 'keep' ? '\u{2705} Keep forever' : o.mode === 'purge' ? `\u{1F504} Purge after ${o.purgeDays}d` : '\u{274C} Deleted'}
                  </div>
                  <button onClick={() => removeOverride(o.id)} style={s.removeBtn}>{'\u{2716}'}</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Danger zone */}
        <div style={s.section}>
          <div style={s.sectionTitle}>Cache Management</div>
          <button onClick={() => {
            if (confirm('Clear all cached data? This cannot be undone. Hosted community data is preserved.')) {
              clearCache();
            }
          }} style={s.dangerBtn}>
            {'\u{1F5D1}\u{FE0F}'} Clear All Cache
          </button>
          <div style={s.dangerDesc}>
            Removes cached data from non-hosted communities. Messages from hosted communities and DMs are preserved.
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, sub }: { label: string; value: string; sub?: string }): React.JSX.Element {
  return (
    <div style={s.statBox}>
      <div style={s.statValue}>{value}</div>
      <div style={s.statLabel}>{label}</div>
      {sub && <div style={s.statSub}>{sub}</div>}
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
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
  tierCard: { display: 'flex', gap: '12px', alignItems: 'center', padding: '12px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' } as React.CSSProperties,
  tierIcon: { fontSize: '28px' } as React.CSSProperties,
  tierInfo: { flex: 1 } as React.CSSProperties,
  tierLabel: { fontSize: '14px', fontWeight: 600 } as React.CSSProperties,
  tierDesc: { fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '2px' } as React.CSSProperties,
  statsGrid: { display: 'flex', gap: '8px', flexWrap: 'wrap' as const } as React.CSSProperties,
  statBox: { padding: '10px 14px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', minWidth: '80px', textAlign: 'center' as const } as React.CSSProperties,
  statValue: { fontSize: '18px', fontWeight: 700 } as React.CSSProperties,
  statLabel: { fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' } as React.CSSProperties,
  statSub: { fontSize: '9px', color: 'var(--color-text-muted)' } as React.CSSProperties,
  modeList: { display: 'flex', flexDirection: 'column' as const, gap: '8px' } as React.CSSProperties,
  modeBtn: { display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'left' as const, color: 'var(--color-text-primary)' } as React.CSSProperties,
  modeRadio: { width: '18px', height: '18px', borderRadius: '50%', border: '2px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px' } as React.CSSProperties,
  modeRadioInner: { width: '10px', height: '10px', borderRadius: '50%' } as React.CSSProperties,
  modeLabel: { fontSize: '13px', fontWeight: 600 } as React.CSSProperties,
  modeDesc: { fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '2px', lineHeight: 1.4 } as React.CSSProperties,
  purgeConfig: { marginTop: '12px', padding: '12px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' } as React.CSSProperties,
  inputLabel: { fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '6px', display: 'block' } as React.CSSProperties,
  purgeRow: { display: 'flex', alignItems: 'center', gap: '8px' } as React.CSSProperties,
  input: { width: '80px', padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontSize: '14px' } as React.CSSProperties,
  inputSuffix: { fontSize: '13px', color: 'var(--color-text-muted)' } as React.CSSProperties,
  overrideDesc: { fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '8px' } as React.CSSProperties,
  addBtn: { padding: '4px 10px', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--color-accent)', fontSize: '11px', fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  overrideForm: { padding: '12px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', marginBottom: '8px' } as React.CSSProperties,
  select: { width: '100%', padding: '8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontSize: '13px' } as React.CSSProperties,
  overrideBtns: { display: 'flex', gap: '6px', marginTop: '8px' } as React.CSSProperties,
  overrideActionBtn: { padding: '6px 12px', border: 'none', borderRadius: 'var(--radius-md)', color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  overrideList: { display: 'flex', flexDirection: 'column' as const, gap: '4px', marginTop: '8px' } as React.CSSProperties,
  overrideRow: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' } as React.CSSProperties,
  overrideName: { fontSize: '13px', fontWeight: 500, flex: 1 } as React.CSSProperties,
  overrideMode: { fontSize: '11px', color: 'var(--color-text-muted)' } as React.CSSProperties,
  removeBtn: { padding: '2px 6px', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', fontSize: '12px', cursor: 'pointer' } as React.CSSProperties,
  dangerBtn: { padding: '10px 20px', border: '1px solid #E24B4A', borderRadius: 'var(--radius-md)', background: 'transparent', color: '#E24B4A', fontSize: '13px', fontWeight: 600, cursor: 'pointer', marginBottom: '8px' } as React.CSSProperties,
  dangerDesc: { fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: 1.4 } as React.CSSProperties,
} as const;
