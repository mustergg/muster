/**
 * opMaterializer — R25 / Phase 3.
 *
 * Fold a set of AdminOps into a deterministic "materialised view" of
 * community admin state. Two nodes holding the same op set must arrive
 * at the same view regardless of the order ops were received on the wire.
 *
 * Spec: docs/specs/OPLOG.md §Materialised view.
 *
 * Algorithm (Kahn's topological sort with deterministic tiebreak):
 *   1. Build parent→children map from prevOpHash edges.
 *   2. Seed the frontier with every op whose parent is not present in
 *      the set (genesis, plus orphans whose parent we've never seen —
 *      these get applied first, sorted by (ts, authorId)).
 *   3. Repeatedly pop the lex-min frontier entry, apply it, then push
 *      any children whose parent just got processed.
 *
 * Ties within a frontier use (ts asc, authorId asc) where
 *   authorId = SHA-256(authorPubkey).
 */

import { sha256, decodeCanonical } from '@muster/crypto';
import {
  manifestFromCborMap,
  type CommunityManifest,
  type ManifestAdmin,
  type Permission,
} from '@muster/protocol';
import type { StoredOp } from './opLogDB';

// ─── State shape ────────────────────────────────────────────────────────────

export interface MaterializedChannel {
  channelId: Uint8Array;   // 32B = SHA-256(communityId || channelLocalId)
  name: string;
  visibility: 'public' | 'private';
  type: 'text' | 'voice';
}

export interface MaterializedRole {
  id: Uint8Array;          // 16B role id
  name: string;
  permissions: Permission[];
}

export interface MaterializedState {
  /** Latest manifest accepted via a manifest_update op. Null until first. */
  manifest: CommunityManifest | null;
  /** Admin roster derived from admin_* ops on top of the manifest. */
  admins: Map<string, ManifestAdmin>;  // key = hex(pubkey)
  /** Channel state. */
  channels: Map<string, MaterializedChannel>;  // key = hex(channelId)
  /** Current members (invited, not kicked, not banned). */
  members: Set<string>;     // hex(pubkey)
  /** Banned members. */
  bans: Set<string>;        // hex(pubkey)
  /** Role catalogue. */
  roles: Map<string, MaterializedRole>;  // key = hex(roleId)
  /** Member → Set<roleId hex>. */
  memberRoles: Map<string, Set<string>>;
  /** Number of ops applied, in order. Debug / replay. */
  applied: number;
  /** Number of ops dropped because their parent never arrived. */
  orphaned: number;
}

export function emptyState(): MaterializedState {
  return {
    manifest: null,
    admins: new Map(),
    channels: new Map(),
    members: new Set(),
    bans: new Set(),
    roles: new Map(),
    memberRoles: new Map(),
    applied: 0,
    orphaned: 0,
  };
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Apply every op in `ops` to a fresh state and return it. Input may be
 * in any order; the materialiser re-sorts into causal-topological order
 * before applying.
 */
export function materialize(ops: StoredOp[]): MaterializedState {
  const state = emptyState();
  const sorted = causalTopoSort(ops);
  for (const op of sorted) applyOp(state, op);
  state.applied = sorted.length;
  state.orphaned = ops.length - sorted.length;
  return state;
}

// ─── Causal topo sort ───────────────────────────────────────────────────────

function causalTopoSort(ops: StoredOp[]): StoredOp[] {
  const byOpId = new Map<string, StoredOp>();
  const children = new Map<string, StoredOp[]>();        // parentHex → children
  for (const op of ops) byOpId.set(bufKey(op.opId), op);

  for (const op of ops) {
    if (!op.prevOpHash) continue;
    const parentHex = bufKey(op.prevOpHash);
    if (!byOpId.has(parentHex)) continue;                // orphan — seeded into frontier
    const list = children.get(parentHex) ?? [];
    list.push(op);
    children.set(parentHex, list);
  }

  // Frontier: ops whose parent is absent from the set (genesis + orphans).
  const frontier: StoredOp[] = ops.filter((op) => {
    if (!op.prevOpHash) return true;
    return !byOpId.has(bufKey(op.prevOpHash));
  });

  const sorted: StoredOp[] = [];
  const processed = new Set<string>();

  while (frontier.length > 0) {
    // Pop deterministic minimum by (ts asc, authorId asc).
    frontier.sort(compareStored);
    const next = frontier.shift()!;
    const key = bufKey(next.opId);
    if (processed.has(key)) continue;
    processed.add(key);
    sorted.push(next);

    const kids = children.get(key) ?? [];
    for (const k of kids) frontier.push(k);
  }

  return sorted;
}

function compareStored(a: StoredOp, b: StoredOp): number {
  if (a.ts !== b.ts) return a.ts - b.ts;
  const aid = sha256(new Uint8Array(a.authorPubkey));
  const bid = sha256(new Uint8Array(b.authorPubkey));
  return compareBytes(aid, bid);
}

// ─── Apply one op ───────────────────────────────────────────────────────────

function applyOp(state: MaterializedState, op: StoredOp): void {
  let args: Record<string, unknown>;
  try {
    args = decodeCanonical(new Uint8Array(op.argsCBOR)) as Record<string, unknown>;
  } catch {
    console.warn(`[opMaterializer] skipping op ${bufKey(op.opId).slice(0, 12)} — bad args CBOR`);
    return;
  }

  switch (op.opType) {
    case 'manifest_update':  applyManifestUpdate(state, args); return;
    case 'admin_add':        applyAdminAdd(state, args); return;
    case 'admin_remove':     applyAdminRemove(state, args); return;
    case 'admin_permissions':applyAdminPerms(state, args); return;
    case 'channel_create':   applyChannelCreate(state, op.communityId, args); return;
    case 'channel_delete':   applyChannelDelete(state, args); return;
    case 'channel_rename':   applyChannelRename(state, args); return;
    case 'channel_visibility':applyChannelVisibility(state, args); return;
    case 'member_invite':    applyMemberInvite(state, args); return;
    case 'member_kick':      applyMemberKick(state, args); return;
    case 'member_ban':       applyMemberBan(state, args); return;
    case 'member_unban':     applyMemberUnban(state, args); return;
    case 'role_create':      applyRoleCreate(state, args); return;
    case 'role_assign':      applyRoleAssign(state, args); return;
    default:
      console.warn(`[opMaterializer] unknown opType ${op.opType}`);
  }
}

// ─── Op appliers ────────────────────────────────────────────────────────────

function applyManifestUpdate(state: MaterializedState, args: Record<string, unknown>): void {
  const newManifestMap = args.newManifest;
  if (!isRecord(newManifestMap)) return;
  try {
    state.manifest = manifestFromCborMap(newManifestMap);
    // Seed admin roster from the manifest — subsequent admin_* ops layer on top.
    state.admins.clear();
    for (const a of state.manifest.admins) {
      state.admins.set(hex(a.pubkey), { pubkey: a.pubkey, permissions: a.permissions.slice() });
    }
  } catch (err) {
    console.warn('[opMaterializer] manifest_update: bad manifest —', err);
  }
}

function applyAdminAdd(state: MaterializedState, args: Record<string, unknown>): void {
  const pk = asBytes(args.pubkey);
  const perms = asStringArray(args.permissions) as Permission[];
  if (!pk) return;
  state.admins.set(hex(pk), { pubkey: pk, permissions: perms });
}

function applyAdminRemove(state: MaterializedState, args: Record<string, unknown>): void {
  const pk = asBytes(args.pubkey);
  if (!pk) return;
  state.admins.delete(hex(pk));
}

function applyAdminPerms(state: MaterializedState, args: Record<string, unknown>): void {
  const pk = asBytes(args.pubkey);
  const perms = asStringArray(args.permissions) as Permission[];
  if (!pk) return;
  const existing = state.admins.get(hex(pk));
  if (existing) existing.permissions = perms;
  else state.admins.set(hex(pk), { pubkey: pk, permissions: perms });
}

function applyChannelCreate(state: MaterializedState, communityId: Buffer, args: Record<string, unknown>): void {
  const localId = asBytes(args.channelLocalId);
  if (!localId || localId.length !== 16) return;
  const name = typeof args.name === 'string' ? args.name : '';
  const visibility = args.visibility === 'private' ? 'private' : 'public';
  const type = args.type === 'voice' ? 'voice' : 'text';

  // Deterministic channelId = SHA-256(communityId || channelLocalId).
  const cid = sha256(concat(new Uint8Array(communityId), localId));
  state.channels.set(hex(cid), { channelId: cid, name, visibility, type });
}

function applyChannelDelete(state: MaterializedState, args: Record<string, unknown>): void {
  const cid = asBytes(args.channelId);
  if (!cid) return;
  state.channels.delete(hex(cid));
}

function applyChannelRename(state: MaterializedState, args: Record<string, unknown>): void {
  const cid = asBytes(args.channelId);
  if (!cid) return;
  const ch = state.channels.get(hex(cid));
  if (ch && typeof args.newName === 'string') ch.name = args.newName;
}

function applyChannelVisibility(state: MaterializedState, args: Record<string, unknown>): void {
  const cid = asBytes(args.channelId);
  if (!cid) return;
  const ch = state.channels.get(hex(cid));
  if (!ch) return;
  if (args.visibility === 'public' || args.visibility === 'private') ch.visibility = args.visibility;
}

function applyMemberInvite(state: MaterializedState, args: Record<string, unknown>): void {
  const pk = asBytes(args.pubkey);
  if (!pk) return;
  state.members.add(hex(pk));
}

function applyMemberKick(state: MaterializedState, args: Record<string, unknown>): void {
  const pk = asBytes(args.pubkey);
  if (!pk) return;
  state.members.delete(hex(pk));
  state.memberRoles.delete(hex(pk));
}

function applyMemberBan(state: MaterializedState, args: Record<string, unknown>): void {
  const pk = asBytes(args.pubkey);
  if (!pk) return;
  const k = hex(pk);
  state.members.delete(k);
  state.memberRoles.delete(k);
  state.bans.add(k);
}

function applyMemberUnban(state: MaterializedState, args: Record<string, unknown>): void {
  const pk = asBytes(args.pubkey);
  if (!pk) return;
  state.bans.delete(hex(pk));
}

function applyRoleCreate(state: MaterializedState, args: Record<string, unknown>): void {
  const id = asBytes(args.id);
  if (!id || id.length !== 16) return;
  const name = typeof args.name === 'string' ? args.name : '';
  const perms = asStringArray(args.permissions) as Permission[];
  state.roles.set(hex(id), { id, name, permissions: perms });
}

function applyRoleAssign(state: MaterializedState, args: Record<string, unknown>): void {
  const pk = asBytes(args.pubkey);
  const roleId = asBytes(args.roleId);
  if (!pk || !roleId) return;
  const k = hex(pk);
  const set = state.memberRoles.get(k) ?? new Set<string>();
  set.add(hex(roleId));
  state.memberRoles.set(k, set);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function bufKey(b: Buffer | Uint8Array | null): string {
  if (!b) return '';
  return Buffer.from(b).toString('hex');
}

function hex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    if (av !== bv) return av - bv;
  }
  return a.length - b.length;
}

function asBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (v instanceof Buffer) return new Uint8Array(v);
  return null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array);
}
