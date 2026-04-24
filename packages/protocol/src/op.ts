/**
 * @muster/protocol/op — AdminOp (R25 / Phase 3).
 *
 * Causally-ordered log entry for community administrative actions.
 * Replaces wall-clock-ordered admin tables with a `prevOpHash`-chained
 * log whose materialised state converges across peers regardless of
 * delivery order.
 *
 * Spec: docs/specs/OPLOG.md.
 *
 * Encoding: canonical CBOR (RFC 8949 §4.2). Signed by the acting admin
 * over canonicalCBOR(op \ sig). `opId = SHA-256(canonicalCBOR(op))`
 * (signature included).
 */

import type { Permission } from './permissions.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export const OP_V = 1;

export type OpType =
  | 'manifest_update'
  | 'admin_add'
  | 'admin_remove'
  | 'admin_permissions'
  | 'channel_create'
  | 'channel_delete'
  | 'channel_rename'
  | 'channel_visibility'
  | 'member_invite'
  | 'member_kick'
  | 'member_ban'
  | 'member_unban'
  | 'role_create'
  | 'role_assign';

export interface AdminOp {
  v: 1;
  /** 32-byte community id (same as the manifest). */
  communityId: Uint8Array;
  opType: OpType;
  /** CBOR-encodable args. Schema keyed by `opType` — see docs/specs/OPLOG.md. */
  args: Record<string, unknown>;
  /** 32-byte Ed25519 of the acting admin (or owner). */
  authorPubkey: Uint8Array;
  /** Wall-clock; advisory, used only as tiebreak for concurrent ops. */
  ts: number;
  /** 32-byte opId of the most-recent op the author observed. null at genesis. */
  prevOpHash: Uint8Array | null;
  /** 64-byte Ed25519 over canonicalCBOR(op \ sig). */
  sig: Uint8Array;
}

export type UnsignedOp = Omit<AdminOp, 'sig'>;

// ─── Limits ─────────────────────────────────────────────────────────────────

export const OP_CLOCK_SKEW_MS = 30 * 60 * 1000;     // ±30 min
export const OP_PARENT_WAIT_MS = 120 * 1000;        // 120 s
export const OP_MAX_ARGS_BYTES = 64 * 1024;         // 64 KB
export const OP_MAX_OUTSTANDING_PER_ADMIN = 10;

// ─── CBOR conversion ────────────────────────────────────────────────────────

/**
 * Canonical CBOR map for the signed op. Callers should pipe this through
 * `@muster/crypto` encodeCanonical, then SHA-256 for `opId`.
 */
export function opToCborMap(op: AdminOp): Record<string, unknown> {
  const out: Record<string, unknown> = {
    v: op.v,
    communityId: op.communityId,
    opType: op.opType,
    args: op.args,
    authorPubkey: op.authorPubkey,
    ts: op.ts,
    sig: op.sig,
  };
  if (op.prevOpHash) out.prevOpHash = op.prevOpHash;
  return out;
}

/** CBOR map for the unsigned form (what the author signs over). */
export function opToUnsignedCborMap(op: UnsignedOp): Record<string, unknown> {
  const out: Record<string, unknown> = {
    v: op.v,
    communityId: op.communityId,
    opType: op.opType,
    args: op.args,
    authorPubkey: op.authorPubkey,
    ts: op.ts,
  };
  if (op.prevOpHash) out.prevOpHash = op.prevOpHash;
  return out;
}

export function opFromCborMap(map: Record<string, unknown>): AdminOp {
  const op: AdminOp = {
    v: 1,
    communityId: asBytes(map.communityId, 'communityId'),
    opType: asOpType(map.opType),
    args: asRecord(map.args, 'args'),
    authorPubkey: asBytes(map.authorPubkey, 'authorPubkey'),
    ts: asNumber(map.ts, 'ts'),
    prevOpHash: null,
    sig: asBytes(map.sig, 'sig'),
  };
  if (map.prevOpHash) op.prevOpHash = asBytes(map.prevOpHash, 'prevOpHash');
  return op;
}

// ─── Op-args schema validation ──────────────────────────────────────────────

/**
 * Shallow shape check of `args` per `opType`. Does NOT verify authority;
 * that lives in opHandler against the materialised manifest. Returns
 * null on OK, or a human-readable reason on failure.
 */
export function validateOpArgs(op: AdminOp): string | null {
  const a = op.args;
  switch (op.opType) {
    case 'manifest_update':
      if (!isRecord(a.newManifest)) return 'args.newManifest must be a manifest object';
      return null;
    case 'admin_add':
    case 'admin_permissions':
      if (!isBytes(a.pubkey, 32)) return 'args.pubkey must be 32 bytes';
      if (!Array.isArray(a.permissions)) return 'args.permissions must be an array';
      return null;
    case 'admin_remove':
    case 'member_unban':
      if (!isBytes(a.pubkey, 32)) return 'args.pubkey must be 32 bytes';
      return null;
    case 'channel_create':
      if (!isBytes(a.channelLocalId, 16)) return 'args.channelLocalId must be 16 bytes';
      if (typeof a.name !== 'string') return 'args.name must be a string';
      if (a.visibility !== 'public' && a.visibility !== 'private') return 'args.visibility must be public|private';
      if (a.type !== 'text' && a.type !== 'voice') return 'args.type must be text|voice';
      return null;
    case 'channel_delete':
      if (!isBytes(a.channelId, 32)) return 'args.channelId must be 32 bytes';
      return null;
    case 'channel_rename':
      if (!isBytes(a.channelId, 32)) return 'args.channelId must be 32 bytes';
      if (typeof a.newName !== 'string') return 'args.newName must be a string';
      return null;
    case 'channel_visibility':
      if (!isBytes(a.channelId, 32)) return 'args.channelId must be 32 bytes';
      if (a.visibility !== 'public' && a.visibility !== 'private') return 'args.visibility must be public|private';
      return null;
    case 'member_invite':
    case 'member_kick':
    case 'member_ban':
      if (!isBytes(a.pubkey, 32)) return 'args.pubkey must be 32 bytes';
      return null;
    case 'role_create':
      if (!isBytes(a.id, 16)) return 'args.id must be 16 bytes';
      if (typeof a.name !== 'string') return 'args.name must be a string';
      if (!Array.isArray(a.permissions)) return 'args.permissions must be an array';
      return null;
    case 'role_assign':
      if (!isBytes(a.pubkey, 32)) return 'args.pubkey must be 32 bytes';
      if (!isBytes(a.roleId, 16)) return 'args.roleId must be 16 bytes';
      return null;
    default:
      return `unknown opType ${op.opType}`;
  }
}

/** Which ops require the owner (vs any admin with a permission bit). */
export function isOwnerOnlyOp(opType: OpType): boolean {
  return opType === 'manifest_update'
    || opType === 'admin_add'
    || opType === 'admin_remove'
    || opType === 'admin_permissions';
}

/** Permission bit required for non-owner ops. Returns null for owner-only. */
export function requiredPermission(opType: OpType): Permission | null {
  switch (opType) {
    case 'channel_create':
    case 'channel_delete':
    case 'channel_rename':
    case 'channel_visibility':
      return 'manage_channels';
    case 'member_invite':
    case 'member_kick':
    case 'member_ban':
    case 'member_unban':
      return 'manage_members';
    case 'role_create':
    case 'role_assign':
      return 'manage_roles';
    default:
      return null;
  }
}

// ─── Tiebreak helpers (concurrent ops) ──────────────────────────────────────

/**
 * Deterministic compare for concurrent ops: (ts asc, authorId asc)
 * where authorId = SHA-256(authorPubkey). Callers that already have
 * authorIds prefer `compareOpsById`.
 */
export function compareOpsByIdBytes(
  a: { ts: number; authorId: Uint8Array },
  b: { ts: number; authorId: Uint8Array },
): number {
  if (a.ts !== b.ts) return a.ts - b.ts;
  return compareBytes(a.authorId, b.authorId);
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function asBytes(v: unknown, name: string): Uint8Array {
  if (v instanceof Uint8Array) return v;
  throw new Error(`op: field ${name} must be bytes`);
}

function asNumber(v: unknown, name: string): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  throw new Error(`op: field ${name} must be a number`);
}

function asRecord(v: unknown, name: string): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array)) {
    return v as Record<string, unknown>;
  }
  throw new Error(`op: field ${name} must be a map`);
}

function asOpType(v: unknown): OpType {
  const allowed: OpType[] = [
    'manifest_update', 'admin_add', 'admin_remove', 'admin_permissions',
    'channel_create', 'channel_delete', 'channel_rename', 'channel_visibility',
    'member_invite', 'member_kick', 'member_ban', 'member_unban',
    'role_create', 'role_assign',
  ];
  if (typeof v === 'string' && (allowed as string[]).includes(v)) return v as OpType;
  throw new Error(`op: bad opType ${String(v)}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array);
}

function isBytes(v: unknown, len?: number): v is Uint8Array {
  if (!(v instanceof Uint8Array)) return false;
  if (typeof len === 'number' && v.length !== len) return false;
  return true;
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
