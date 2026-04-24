/**
 * @muster/protocol/manifest — signed community manifest (R25 / Phase 2).
 *
 * Wire spec: docs/specs/OPLOG.md (manifest_update args). Phase 2 ships
 * the standalone manifest type + canonical CBOR helpers; Phase 3 wraps
 * each manifest update inside an AdminOp.
 *
 * The manifest is the authoritative snapshot of admin state per
 * community: owner, admin roster, channel list, member-list digest.
 * Every envelope acceptance and every admin op is validated against
 * the latest known manifest.
 *
 * Encoding: canonical CBOR (RFC 8949 §4.2). Signed by the owner over
 * canonicalCBOR(manifest \ sig).
 */

import type { Permission } from './permissions.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ManifestAdmin {
  pubkey: Uint8Array;        // 32 bytes Ed25519
  permissions: Permission[]; // grants — see permissions.ts
}

export type ManifestChannelType = 'text' | 'voice';
export type ManifestChannelVisibility = 'public' | 'private';

export interface ManifestChannel {
  id: Uint8Array;            // 32 bytes — same shape as ChannelID in spec
  name: string;
  visibility: ManifestChannelVisibility;
  type: ManifestChannelType;
}

export interface CommunityManifest {
  v: 1;
  /** 32-byte community id. communityId = H(canonicalCBOR(manifestV0)). */
  communityId: Uint8Array;
  /** Monotonic counter. Starts at 0 (genesis manifest). */
  version: number;
  /** 32-byte Ed25519 pubkey. Owner has implicit all-permissions. */
  owner: Uint8Array;
  /** Sorted by `pubkey` bytewise — the canonical encoder will keep order. */
  admins: ManifestAdmin[];
  /** Sorted by `id` bytewise. */
  channels: ManifestChannel[];
  /** SHA-256 of canonicalCBOR(sorted member pubkey list). */
  memberListHash: Uint8Array;
  /** Creation / update wall-clock — advisory only. */
  ts: number;
  /** 32-byte SHA-256 of the previous manifest CBOR (with sig). null at genesis. */
  prevManifestHash: Uint8Array | null;
  /** 64-byte Ed25519 signature by `owner` over canonicalCBOR(manifest \ sig). */
  sig: Uint8Array;
}

export type UnsignedManifest = Omit<CommunityManifest, 'sig'>;

// ─── Limits ─────────────────────────────────────────────────────────────────

export const MANIFEST_V = 1;
export const MAX_ADMINS = 32;
export const MAX_CHANNELS = 256;
export const MAX_CHANNEL_NAME_LEN = 100;
export const MANIFEST_CLOCK_SKEW_MS = 30 * 60 * 1000; // ±30 min

// ─── CBOR conversion ────────────────────────────────────────────────────────

/**
 * Serialise the manifest to a CBOR-canonical map. Caller pipes the result
 * through @muster/crypto encodeCanonical and SHA-256s for the manifest id.
 */
export function manifestToCborMap(m: CommunityManifest): Record<string, unknown> {
  const out: Record<string, unknown> = {
    v: m.v,
    communityId: m.communityId,
    version: m.version,
    owner: m.owner,
    admins: m.admins.map(adminToCbor),
    channels: m.channels.map(channelToCbor),
    memberListHash: m.memberListHash,
    ts: m.ts,
    sig: m.sig,
  };
  if (m.prevManifestHash) out.prevManifestHash = m.prevManifestHash;
  return out;
}

export function manifestToUnsignedCborMap(m: UnsignedManifest): Record<string, unknown> {
  const out: Record<string, unknown> = {
    v: m.v,
    communityId: m.communityId,
    version: m.version,
    owner: m.owner,
    admins: m.admins.map(adminToCbor),
    channels: m.channels.map(channelToCbor),
    memberListHash: m.memberListHash,
    ts: m.ts,
  };
  if (m.prevManifestHash) out.prevManifestHash = m.prevManifestHash;
  return out;
}

export function manifestFromCborMap(map: Record<string, unknown>): CommunityManifest {
  const m: CommunityManifest = {
    v: 1,
    communityId: asBytes(map.communityId, 'communityId'),
    version: asNumber(map.version, 'version'),
    owner: asBytes(map.owner, 'owner'),
    admins: asArray(map.admins, 'admins').map(cborToAdmin),
    channels: asArray(map.channels, 'channels').map(cborToChannel),
    memberListHash: asBytes(map.memberListHash, 'memberListHash'),
    ts: asNumber(map.ts, 'ts'),
    prevManifestHash: null,
    sig: asBytes(map.sig, 'sig'),
  };
  if (map.prevManifestHash) m.prevManifestHash = asBytes(map.prevManifestHash, 'prevManifestHash');
  return m;
}

// ─── Authority predicates ───────────────────────────────────────────────────

/** True if `pubkey` is the owner. */
export function isOwner(m: CommunityManifest, pubkey: Uint8Array): boolean {
  return bytesEqual(m.owner, pubkey);
}

/** True if `pubkey` is the owner or an admin (permission-agnostic). */
export function isAdmin(m: CommunityManifest, pubkey: Uint8Array): boolean {
  if (isOwner(m, pubkey)) return true;
  return m.admins.some((a) => bytesEqual(a.pubkey, pubkey));
}

/** True if `pubkey` has the requested permission. */
export function hasPermission(m: CommunityManifest, pubkey: Uint8Array, perm: Permission): boolean {
  if (isOwner(m, pubkey)) return true;
  const a = m.admins.find((x) => bytesEqual(x.pubkey, pubkey));
  return a?.permissions.includes(perm) ?? false;
}

/** Lookup channel by 32-byte id. */
export function findChannel(m: CommunityManifest, channelId: Uint8Array): ManifestChannel | undefined {
  return m.channels.find((c) => bytesEqual(c.id, channelId));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function adminToCbor(a: ManifestAdmin): Record<string, unknown> {
  return { pubkey: a.pubkey, permissions: a.permissions.slice().sort() };
}

function cborToAdmin(v: unknown): ManifestAdmin {
  const obj = v as Record<string, unknown>;
  return {
    pubkey: asBytes(obj.pubkey, 'admin.pubkey'),
    permissions: asArray(obj.permissions, 'admin.permissions').map((p) => String(p) as Permission),
  };
}

function channelToCbor(c: ManifestChannel): Record<string, unknown> {
  return { id: c.id, name: c.name, visibility: c.visibility, type: c.type };
}

function cborToChannel(v: unknown): ManifestChannel {
  const obj = v as Record<string, unknown>;
  return {
    id: asBytes(obj.id, 'channel.id'),
    name: String(obj.name),
    visibility: asVisibility(obj.visibility),
    type: asChannelType(obj.type),
  };
}

function asBytes(v: unknown, name: string): Uint8Array {
  if (v instanceof Uint8Array) return v;
  throw new Error(`manifest: field ${name} must be bytes`);
}

function asNumber(v: unknown, name: string): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  throw new Error(`manifest: field ${name} must be a number`);
}

function asArray(v: unknown, name: string): unknown[] {
  if (Array.isArray(v)) return v;
  throw new Error(`manifest: field ${name} must be an array`);
}

function asVisibility(v: unknown): ManifestChannelVisibility {
  if (v === 'public' || v === 'private') return v;
  throw new Error(`manifest: bad channel visibility ${String(v)}`);
}

function asChannelType(v: unknown): ManifestChannelType {
  if (v === 'text' || v === 'voice') return v;
  throw new Error(`manifest: bad channel type ${String(v)}`);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
