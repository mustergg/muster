/**
 * CommunityGovernanceModal — R25 / Phase 2.
 *
 * Surfaces the community's signed manifest (owner + admin roster + version)
 * and lets the owner manage the admin roster. The manifest is the authority
 * the relay enforces for admin ops (apps/relay/src/opHandler.ts) — so admins
 * added here can author signed admin ops, verified against this roster.
 *
 * The manifest carries its own self-derived communityId
 * (H(canonicalCBOR(genesisManifest))); we keep a localStorage map from the
 * legacy community id → manifest community id so the panel can re-load the
 * right manifest after a reload.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toHex, fromHex, sha256 } from '@muster/crypto';
import type { ManifestAdmin, ManifestChannel, Permission } from '@muster/protocol';
import { useManifestStore } from '../stores/manifestStore.js';
import { useCommunityStore } from '../stores/communityStore.js';
import { useAuthStore } from '../stores/authStore.js';

interface Props {
  communityId: string;
  onClose: () => void;
}

/** Default coarse permissions granted to a manifest admin (opHandler maps
 *  these 1:N during enforcement). */
const DEFAULT_ADMIN_PERMS: Permission[] = ['manage_channels', 'manage_members', 'moderate_messages'];

const LS_MAP_KEY = 'muster-manifest-map';

function loadMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LS_MAP_KEY) || '{}'); } catch { return {}; }
}
function saveMap(m: Record<string, string>): void {
  try { localStorage.setItem(LS_MAP_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}

/** Map a legacy channel id string → 32-byte ManifestChannel id (matches the
 *  derivation chatStore uses for envelope channelIds). */
function channelIdBytes(id: string): Uint8Array {
  return sha256(new TextEncoder().encode(`channel:${id}`));
}

export default function CommunityGovernanceModal({ communityId, onClose }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { communities, members } = useCommunityStore();
  const manifestStore = useManifestStore();
  const keypair = useAuthStore((s) => s._keypair);
  const myPubHex = useAuthStore((s) => s.publicKeyHex);

  const community = communities[communityId];
  const communityMembers = members[communityId] || [];

  const [map, setMap] = useState<Record<string, string>>(loadMap);
  const manifestIdHex = map[communityId];
  const entry = manifestIdHex ? manifestStore.getLatest(manifestIdHex) : undefined;
  const manifest = entry?.manifest;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickMember, setPickMember] = useState('');

  const isOwner = !!manifest && !!myPubHex && toHex(manifest.owner) === myPubHex;
  // Before a manifest exists, the legacy community owner may bootstrap it.
  const isLegacyOwner = !!community && community.ownerPublicKey === myPubHex;

  useEffect(() => {
    if (manifestIdHex) manifestStore.fetchLatest(manifestIdHex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifestIdHex]);

  const channelsForManifest = useMemo<ManifestChannel[]>(() => {
    return (community?.channels || []).map((ch) => ({
      id: channelIdBytes(ch.id),
      name: ch.name.slice(0, 100),
      visibility: ch.visibility === 'private' ? 'private' : 'public',
      type: ch.type === 'voice' || ch.type === 'voice-temp' ? 'voice' : 'text',
    }));
  }, [community]);

  const memberPubkeys = useMemo<Uint8Array[]>(() => {
    const keys = new Set<string>();
    if (myPubHex) keys.add(myPubHex);
    for (const m of communityMembers) keys.add(m.publicKey);
    return [...keys].map((k) => fromHex(k));
  }, [communityMembers, myPubHex]);

  const enableGovernance = async (): Promise<void> => {
    if (!keypair) { setError('Keypair unavailable'); return; }
    setBusy(true); setError(null);
    try {
      const built = await manifestStore.createCommunity({
        ownerPubkey: keypair.publicKey,
        ownerPrivkey: keypair.privateKey,
        admins: [],
        channels: channelsForManifest,
        memberPubkeys,
      });
      const idHex = toHex(built.manifest.communityId);
      const next = { ...map, [communityId]: idHex };
      saveMap(next); setMap(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const republish = async (admins: ManifestAdmin[]): Promise<void> => {
    if (!keypair || !manifestIdHex) return;
    setBusy(true); setError(null);
    try {
      await manifestStore.updateCommunity({
        communityIdHex: manifestIdHex,
        ownerPrivkey: keypair.privateKey,
        admins,
        channels: channelsForManifest,
        memberPubkeys,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addAdmin = async (): Promise<void> => {
    if (!manifest || !pickMember) return;
    const exists = manifest.admins.some((a) => toHex(a.pubkey) === pickMember);
    if (exists) return;
    const next: ManifestAdmin[] = [
      ...manifest.admins,
      { pubkey: fromHex(pickMember), permissions: DEFAULT_ADMIN_PERMS },
    ];
    setPickMember('');
    await republish(next);
  };

  const removeAdmin = async (pubHex: string): Promise<void> => {
    if (!manifest) return;
    const next = manifest.admins.filter((a) => toHex(a.pubkey) !== pubHex);
    await republish(next);
  };

  const nameFor = (pubHex: string): string => {
    const m = communityMembers.find((x) => x.publicKey === pubHex);
    return m?.username || pubHex.slice(0, 10) + '…';
  };

  const candidates = communityMembers.filter((m) =>
    m.publicKey !== myPubHex &&
    !(manifest?.admins.some((a) => toHex(a.pubkey) === m.publicKey)),
  );

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.header}>
          <span style={s.title}>{'\u{1F510}'} {t('governance.title')} — {community?.name || ''}</span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={s.body}>
          {error && <div style={s.error}>{error}</div>}

          {!manifest && (
            <div style={s.section}>
              <p style={s.desc}>{t('governance.noManifest')}</p>
              {isLegacyOwner ? (
                <button style={s.primaryBtn} disabled={busy} onClick={enableGovernance}>
                  {busy ? t('governance.publishing') : t('governance.enable')}
                </button>
              ) : (
                <div style={s.muted}>{t('governance.ownerOnly')}</div>
              )}
            </div>
          )}

          {manifest && (
            <>
              <div style={s.section}>
                <div style={s.rowBetween}>
                  <span style={s.sectionTitle}>{t('governance.manifest')}</span>
                  <span style={s.version}>v{manifest.version}</span>
                </div>
                <div style={s.kv}><span style={s.k}>{t('governance.owner')}</span><span style={s.v}>{nameFor(toHex(manifest.owner))}</span></div>
                <div style={s.kv}><span style={s.k}>{t('governance.communityId')}</span><span style={s.vMono}>{toHex(manifest.communityId).slice(0, 24)}…</span></div>
                <div style={s.kv}><span style={s.k}>{t('governance.channels')}</span><span style={s.v}>{manifest.channels.length}</span></div>
              </div>

              <div style={s.section}>
                <span style={s.sectionTitle}>{t('governance.admins', { count: manifest.admins.length })}</span>
                {manifest.admins.length === 0 && <div style={s.muted}>{t('governance.noAdmins')}</div>}
                {manifest.admins.map((a) => {
                  const hex = toHex(a.pubkey);
                  return (
                    <div key={hex} style={s.adminRow}>
                      <span style={s.adminName}>{nameFor(hex)}</span>
                      <span style={s.adminPerms}>{t('governance.perms', { count: a.permissions.length })}</span>
                      {isOwner && (
                        <button style={s.removeBtn} disabled={busy} onClick={() => removeAdmin(hex)}>{t('governance.remove')}</button>
                      )}
                    </div>
                  );
                })}
              </div>

              {isOwner && (
                <div style={s.section}>
                  <span style={s.sectionTitle}>{t('governance.addAdmin')}</span>
                  <div style={s.addRow}>
                    <select style={s.select} value={pickMember} onChange={(e) => setPickMember(e.target.value)}>
                      <option value="">{t('governance.selectMember')}</option>
                      {candidates.map((m) => (
                        <option key={m.publicKey} value={m.publicKey}>{m.username || m.publicKey.slice(0, 12)}</option>
                      ))}
                    </select>
                    <button style={s.primaryBtn} disabled={busy || !pickMember} onClick={addAdmin}>{t('governance.add')}</button>
                  </div>
                  {candidates.length === 0 && <div style={s.muted}>{t('governance.noEligible')}</div>}
                </div>
              )}

              {!isOwner && (
                <div style={s.muted}>{t('governance.ownerOnlyRoster')}</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const s = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 } as React.CSSProperties,
  modal: { width: '480px', maxWidth: '92vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' as const, background: 'var(--color-bg-primary)', borderRadius: 'var(--radius-lg, 10px)', border: '1px solid var(--color-border)', overflow: 'hidden' } as React.CSSProperties,
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--color-border)' } as React.CSSProperties,
  title: { fontSize: '15px', fontWeight: 700 } as React.CSSProperties,
  closeBtn: { background: 'transparent', border: 'none', color: 'var(--color-text-muted)', fontSize: '16px', cursor: 'pointer' } as React.CSSProperties,
  body: { padding: '18px', overflow: 'auto' } as React.CSSProperties,
  section: { marginBottom: '20px' } as React.CSSProperties,
  sectionTitle: { fontSize: '12px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' } as React.CSSProperties,
  desc: { fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: '12px' } as React.CSSProperties,
  muted: { fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '6px' } as React.CSSProperties,
  rowBetween: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } as React.CSSProperties,
  version: { fontSize: '11px', fontWeight: 700, color: 'var(--color-accent)', background: 'var(--color-accent-dim, rgba(46,117,182,0.12))', padding: '2px 8px', borderRadius: '4px' } as React.CSSProperties,
  kv: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '3px 0' } as React.CSSProperties,
  k: { color: 'var(--color-text-muted)' } as React.CSSProperties,
  v: { fontWeight: 500 } as React.CSSProperties,
  vMono: { fontFamily: 'var(--font-mono, monospace)', fontSize: '11px', color: 'var(--color-text-secondary)' } as React.CSSProperties,
  adminRow: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', marginTop: '6px' } as React.CSSProperties,
  adminName: { flex: 1, fontSize: '13px', fontWeight: 500 } as React.CSSProperties,
  adminPerms: { fontSize: '11px', color: 'var(--color-text-muted)' } as React.CSSProperties,
  removeBtn: { padding: '3px 10px', border: '1px solid #E24B4A', borderRadius: '6px', background: 'transparent', color: '#E24B4A', fontSize: '11px', cursor: 'pointer' } as React.CSSProperties,
  addRow: { display: 'flex', gap: '8px', marginTop: '8px' } as React.CSSProperties,
  select: { flex: 1, padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontSize: '13px' } as React.CSSProperties,
  primaryBtn: { padding: '8px 18px', border: 'none', borderRadius: 'var(--radius-md)', background: 'var(--color-accent)', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  error: { padding: '8px 12px', fontSize: '12px', color: '#E24B4A', background: 'rgba(226,75,74,0.1)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(226,75,74,0.3)', marginBottom: '14px' } as React.CSSProperties,
} as const;
