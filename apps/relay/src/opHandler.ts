/**
 * opHandler — R25 / Phase 3.
 *
 * Wire dispatcher for causal admin ops. Gated behind MUSTER_TWO_LAYER=1
 * (caller checks the flag before invoking).
 *
 * Handles:
 *   - ADMIN_OP          — accept + verify + buffer-if-parent-missing + store + broadcast
 *   - ADMIN_OP_REQUEST  — replay op log for a community (catch-up / replay tool)
 *
 * Validation pipeline per spec docs/specs/OPLOG.md §Validation:
 *   1. Shape: canonical CBOR, args shape matches opType.
 *   2. Version === 1.
 *   3. Signature verifies against authorPubkey over canonicalCBOR(op \ sig).
 *   4. Authority: owner for owner-only ops, OR admin with required permission.
 *      (Computed against the materialised state up to prevOpHash.)
 *   5. Parent present in the op log OR buffer for up to 120 s.
 *   6. Parent op is for the same community.
 *   7. |ts - now| ≤ 30 minutes.
 *
 * Parent-wait buffer is in-memory only (eviction on restart — peers
 * re-broadcast, BitSwap catches the rest in Phase 7). Orphans past
 * OP_PARENT_WAIT_MS are dropped silently.
 */

import type { WebSocket } from 'ws';
import {
  decodeCanonical,
  encodeCanonical,
  fromHex,
  toHex,
  sha256,
  verify as ed25519Verify,
} from '@muster/crypto';
import {
  opFromCborMap,
  opToUnsignedCborMap,
  validateOpArgs,
  isOwnerOnlyOp,
  requiredPermission,
  hasPermission,
  isOwner,
  isAdmin,
  OP_CLOCK_SKEW_MS,
  OP_PARENT_WAIT_MS,
  OP_MAX_ARGS_BYTES,
  type AdminOp,
} from '@muster/protocol';
import type { RelayClient } from './types';
import type { OpLogDB, StoredOp } from './opLogDB';
import type { ManifestDB } from './manifestDB';
import { materialize, type MaterializedState } from './opMaterializer';

type Send = (client: RelayClient, msg: any) => void;

interface PendingOp {
  op: AdminOp;
  opIdBytes: Uint8Array;
  cborBytes: Uint8Array;
  deadline: number;
}

/**
 * In-memory parent-wait buffer. Keyed by missing-parent hex so we can
 * flush when that parent lands. Values are ordered by arrival; eviction
 * sweeps expired entries on every admission.
 */
const pending = new Map<string, PendingOp[]>();

/** Returns true if the message was claimed by this handler. */
export function handleOpMessage(
  client: RelayClient,
  msg: any,
  opLogDB: OpLogDB,
  manifestDB: ManifestDB,
  sendToClient: Send,
  clients: Map<WebSocket, RelayClient>,
): boolean {
  switch (msg.type) {
    case 'ADMIN_OP':
      void handlePublish(client, msg, opLogDB, manifestDB, sendToClient, clients);
      return true;
    case 'ADMIN_OP_REQUEST':
      handleRequest(client, msg, opLogDB, sendToClient);
      return true;
    default:
      return false;
  }
}

// ─── PUBLISH ───────────────────────────────────────────────────────────────

async function handlePublish(
  client: RelayClient,
  msg: any,
  opLogDB: OpLogDB,
  manifestDB: ManifestDB,
  sendToClient: Send,
  clients: Map<WebSocket, RelayClient>,
): Promise<void> {
  sweepExpired();

  const cborB64 = msg.payload?.cbor;
  if (typeof cborB64 !== 'string') {
    return reject(client, sendToClient, msg, 'missing payload.cbor');
  }

  let cborBytes: Uint8Array;
  try { cborBytes = base64Decode(cborB64); }
  catch { return reject(client, sendToClient, msg, 'invalid base64'); }

  let op: AdminOp;
  try {
    const map = decodeCanonical(cborBytes) as Record<string, unknown>;
    op = opFromCborMap(map);
  } catch (err: any) {
    return reject(client, sendToClient, msg, `decode failed: ${err.message}`);
  }

  // 1. Version
  if (op.v !== 1) return reject(client, sendToClient, msg, 'bad version');

  // 2. Args shape + size
  const shapeErr = validateOpArgs(op);
  if (shapeErr) return reject(client, sendToClient, msg, shapeErr);
  const argsCbor = encodeCanonical(op.args as any);
  if (argsCbor.length > OP_MAX_ARGS_BYTES) {
    return reject(client, sendToClient, msg, `args > ${OP_MAX_ARGS_BYTES} bytes`);
  }

  // 3. Clock skew
  const now = Date.now();
  if (Math.abs(op.ts - now) > OP_CLOCK_SKEW_MS) {
    return reject(client, sendToClient, msg, 'ts out of window');
  }

  // 4. Signature
  if (!(await verifyAuthorSig(op))) {
    return reject(client, sendToClient, msg, 'bad author signature');
  }

  const opIdBytes = sha256(cborBytes);

  // 5. Parent presence. Genesis ops (prevOpHash === null) require no parent.
  //    Non-genesis ops must either have the parent already in the log,
  //    OR we buffer this op and try again when the parent arrives.
  if (op.prevOpHash) {
    const parentBuf = Buffer.from(op.prevOpHash);
    const parent = opLogDB.get(parentBuf);
    if (!parent) {
      // Buffer and ack — we'll flush when the parent lands.
      bufferPending(op, opIdBytes, cborBytes);
      sendToClient(client, {
        type: 'ADMIN_OP_ACK',
        payload: {
          opId: toHex(opIdBytes),
          buffered: true,
          reason: 'awaiting parent',
        },
        timestamp: Date.now(),
      });
      return;
    }
    // 6. Parent for same community
    if (!bytesEq(new Uint8Array(parent.communityId), op.communityId)) {
      return reject(client, sendToClient, msg, 'parent community mismatch');
    }
  }

  // 7. Authority check against materialised state up to prevOpHash.
  const authErr = checkAuthority(op, opLogDB, manifestDB);
  if (authErr) return reject(client, sendToClient, msg, authErr);

  // Commit.
  commit(op, opIdBytes, cborBytes, argsCbor, opLogDB, sendToClient, client, clients, cborB64);

  // Flush any pending ops that were waiting on this one.
  const opIdHex = bufKey(opIdBytes);
  const waitList = pending.get(opIdHex);
  if (waitList) {
    pending.delete(opIdHex);
    for (const p of waitList) {
      if (Date.now() > p.deadline) continue;
      // Re-run authority — parent landing may have changed admin state.
      const err = checkAuthority(p.op, opLogDB, manifestDB);
      if (err) {
        if (process.env.MUSTER_TWO_LAYER_DEBUG) {
          console.warn(`[op] drop buffered ${bufKey(p.opIdBytes).slice(0, 12)} on flush: ${err}`);
        }
        continue;
      }
      const pArgs = encodeCanonical(p.op.args as any);
      commit(p.op, p.opIdBytes, p.cborBytes, pArgs, opLogDB, sendToClient, client, clients,
             base64Encode(p.cborBytes));
    }
  }
}

function commit(
  op: AdminOp,
  opIdBytes: Uint8Array,
  cborBytes: Uint8Array,
  argsCbor: Uint8Array,
  opLogDB: OpLogDB,
  sendToClient: Send,
  originClient: RelayClient,
  clients: Map<WebSocket, RelayClient>,
  cborB64: string,
): void {
  const stored: StoredOp = {
    opId: Buffer.from(opIdBytes),
    communityId: Buffer.from(op.communityId),
    opType: op.opType,
    argsCBOR: Buffer.from(argsCbor),
    authorPubkey: Buffer.from(op.authorPubkey),
    ts: op.ts,
    prevOpHash: op.prevOpHash ? Buffer.from(op.prevOpHash) : null,
    sig: Buffer.from(op.sig),
    receivedAt: Date.now(),
  };
  const inserted = opLogDB.store(stored);

  sendToClient(originClient, {
    type: 'ADMIN_OP_ACK',
    payload: {
      opId: toHex(opIdBytes),
      duplicate: !inserted,
    },
    timestamp: Date.now(),
  });

  if (!inserted) return;

  // Broadcast to every authenticated peer. Admin ops are community-public.
  const broadcast = {
    type: 'ADMIN_OP',
    payload: { cbor: cborB64 },
    timestamp: Date.now(),
  };
  for (const peer of clients.values()) {
    if (peer.ws === originClient.ws) continue;
    if (!peer.authenticated) continue;
    sendToClient(peer, broadcast);
  }
}

// ─── REQUEST (catch-up / replay) ───────────────────────────────────────────

function handleRequest(
  client: RelayClient,
  msg: any,
  opLogDB: OpLogDB,
  sendToClient: Send,
): void {
  const communityHex = msg.payload?.communityId;
  if (typeof communityHex !== 'string' || !/^[0-9a-f]+$/i.test(communityHex)) {
    return reject(client, sendToClient, msg, 'bad communityId');
  }
  let communityBytes: Uint8Array;
  try { communityBytes = fromHex(communityHex); }
  catch { return reject(client, sendToClient, msg, 'bad hex'); }

  const rows = opLogDB.getAll(Buffer.from(communityBytes));
  sendToClient(client, {
    type: 'ADMIN_OP_RESPONSE',
    payload: {
      communityId: communityHex,
      count: rows.length,
      ops: rows.map((r) => ({
        opId: r.opId.toString('hex'),
        opType: r.opType,
        ts: r.ts,
        // Reconstruct full CBOR from fields. Clients decode and verify.
        // (We don't store whole-op CBOR; schema stays split for query-ability.)
        cbor: rebuildCborBase64(r),
      })),
    },
    timestamp: Date.now(),
  });
}

// ─── Authority check ───────────────────────────────────────────────────────

function checkAuthority(
  op: AdminOp,
  opLogDB: OpLogDB,
  manifestDB: ManifestDB,
): string | null {
  // Compute materialised state at parent. For Phase 3 we fold ALL ops for
  // the community that are ancestors of op.prevOpHash. Simple path: load
  // every stored op and re-materialise; good enough until Phase 7 when
  // we'll memoise snapshots.
  const all = opLogDB.getAll(Buffer.from(op.communityId));
  const upto = op.prevOpHash ? filterToAncestors(all, op.prevOpHash) : [];
  const state = materialize(upto);

  // The manifest roster is the final source of truth. Fall back to the
  // manifestDB-stored manifest if no manifest_update op has been applied
  // yet (Phase 2 manifests can exist without a corresponding op).
  let manifest = state.manifest;
  if (!manifest) {
    const row = manifestDB.getLatest(Buffer.from(op.communityId));
    if (row) {
      try {
        const map = decodeCanonical(new Uint8Array(row.cbor)) as Record<string, unknown>;
        manifest = (require('@muster/protocol') as typeof import('@muster/protocol'))
          .manifestFromCborMap(map);
      } catch { /* ignore */ }
    }
  }

  if (!manifest) {
    // Only the genesis manifest_update op is allowed without prior state.
    if (op.opType === 'manifest_update' && op.prevOpHash === null) return null;
    return 'no manifest — only genesis manifest_update allowed';
  }

  if (isOwnerOnlyOp(op.opType)) {
    if (!isOwner(manifest, op.authorPubkey)) return `${op.opType} requires owner`;
    return null;
  }

  // Non-owner ops: must be owner or an admin with the required perm.
  if (isOwner(manifest, op.authorPubkey)) return null;
  if (!isAdmin(manifest, op.authorPubkey)) return 'author not in admin roster';

  const needed = requiredPermission(op.opType);
  if (!needed) return null;                 // shouldn't happen, schema-checked
  if (!hasPermission(manifest, op.authorPubkey, needed)) {
    return `missing permission: ${needed}`;
  }
  return null;
}

/**
 * Walk the parent-chain from `target` backwards; return ops in any order
 * — materialiser will topo-sort them again. Not optimal but simple; the
 * op log is expected to be small (hundreds per community, not millions).
 */
function filterToAncestors(all: StoredOp[], targetOpId: Uint8Array): StoredOp[] {
  const byId = new Map<string, StoredOp>();
  for (const o of all) byId.set(bufKey(o.opId), o);

  const out: StoredOp[] = [];
  const seen = new Set<string>();
  const stack: string[] = [bufKey(targetOpId)];

  while (stack.length > 0) {
    const k = stack.pop()!;
    if (seen.has(k)) continue;
    seen.add(k);
    const op = byId.get(k);
    if (!op) continue;                      // orphan reference
    out.push(op);
    if (op.prevOpHash) stack.push(bufKey(op.prevOpHash));
  }
  return out;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function bufferPending(op: AdminOp, opIdBytes: Uint8Array, cborBytes: Uint8Array): void {
  if (!op.prevOpHash) return;              // safety
  const key = bufKey(op.prevOpHash);
  const list = pending.get(key) ?? [];
  list.push({ op, opIdBytes, cborBytes, deadline: Date.now() + OP_PARENT_WAIT_MS });
  pending.set(key, list);
}

function sweepExpired(): void {
  const now = Date.now();
  for (const [parentKey, list] of pending) {
    const alive = list.filter((p) => p.deadline > now);
    if (alive.length === 0) pending.delete(parentKey);
    else if (alive.length !== list.length) pending.set(parentKey, alive);
  }
}

function reject(client: RelayClient, send: Send, msg: any, reason: string): void {
  if (process.env.MUSTER_TWO_LAYER_DEBUG) {
    console.warn(`[op] reject ${msg?.type}: ${reason}`);
  }
  send(client, {
    type: 'ADMIN_OP_ERROR',
    payload: { reason, originalType: msg?.type },
    timestamp: Date.now(),
  });
}

async function verifyAuthorSig(op: AdminOp): Promise<boolean> {
  try {
    const unsignedBytes = encodeCanonical(opToUnsignedCborMap(op) as any);
    return await ed25519Verify(op.sig, unsignedBytes, op.authorPubkey);
  } catch {
    return false;
  }
}

function rebuildCborBase64(r: StoredOp): string {
  // The stored row has split fields; rebuild the canonical CBOR for the
  // client. We have argsCBOR already (so the args encoding is lossless),
  // but the outer op map must be re-encoded. Decode argsCBOR back to a
  // value and re-encode together with the fixed fields.
  const args = decodeCanonical(new Uint8Array(r.argsCBOR));
  const map: Record<string, unknown> = {
    v: 1,
    communityId: new Uint8Array(r.communityId),
    opType: r.opType,
    args,
    authorPubkey: new Uint8Array(r.authorPubkey),
    ts: r.ts,
    sig: new Uint8Array(r.sig),
  };
  if (r.prevOpHash) map.prevOpHash = new Uint8Array(r.prevOpHash);
  return base64Encode(encodeCanonical(map as any));
}

function base64Decode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

function base64Encode(b: Uint8Array): string {
  return Buffer.from(b).toString('base64');
}

function bufKey(b: Uint8Array | Buffer | null): string {
  if (!b) return '';
  return Buffer.from(b).toString('hex');
}

function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Silence unused-state warning until we add snapshot memoisation.
void ({} as MaterializedState);
