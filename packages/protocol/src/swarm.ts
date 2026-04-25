/**
 * @muster/protocol/swarm — BitSwap-lite (R25 / Phase 5).
 *
 * Wire format for the swarm layer: have-list announces, want-requests,
 * want-responses, and cancellations. See docs/specs/BITSWAP.md.
 *
 * All swarm messages ride the existing WebSocket transport wrapped as
 *   { type: 'SWARM', payload: { cbor: base64(canonicalCBOR(SwarmMessage)) } }
 *
 * Encoding is canonical CBOR (RFC 8949 §4.2). HaveAnnounce is signed
 * by the announcing node; WantRequest/Response/Cancel are unsigned —
 * they ride the authenticated peer connection itself.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export const SWARM_V = 1;

export type SwarmMessageKind =
  | 'HAVE_ANNOUNCE'
  | 'WANT_REQUEST'
  | 'WANT_RESPONSE'
  | 'CANCEL';

export type ContentKind = 'piece' | 'chunk' | 'blob' | 'op';

export interface HaveAnnounce {
  kind: 'HAVE_ANNOUNCE';
  /** 32-byte sender node id. */
  nodeId: Uint8Array;
  /** Each entry is 32 bytes: pieceId | chunkId | blobRoot | opId. */
  additions: Uint8Array[];
  /** Content this peer no longer has. */
  removals: Uint8Array[];
  /** Wall-clock ms (advisory; used to discard stale duplicates). */
  ts: number;
  /** Ed25519 over canonicalCBOR(announce \ sig). */
  sig: Uint8Array;
}

export interface WantItem {
  /** 32-byte content id. */
  id: Uint8Array;
  kind: ContentKind;
  /** Include Merkle sibling hashes (pieces only). */
  withProof: boolean;
  /** Optional upper bound on response size. */
  maxBytes?: number;
}

export interface WantRequest {
  kind: 'WANT_REQUEST';
  /** 16-byte request id. Used to match responses + cancels. */
  nonce: Uint8Array;
  wants: WantItem[];
}

export type WantOutcome = 'bytes' | 'notHave' | 'tooBig' | 'rateLimited';

export interface WantResponseItem {
  id: Uint8Array;
  outcome: WantOutcome;
  /** Present when outcome === 'bytes'. */
  bytes?: Uint8Array;
  /** Present when withProof + outcome === 'bytes'. Leaf-to-root order. */
  proof?: Uint8Array[];
  /** Present for piece responses — needed by the receiver to verify the
   *  Merkle path against the blob root. */
  blobRoot?: Uint8Array;
  /** Present for piece responses — index of the piece within its blob. */
  pieceIdx?: number;
  /** Present for piece responses — total piece count of the blob. */
  totalPieces?: number;
}

export interface WantResponse {
  kind: 'WANT_RESPONSE';
  /** Matches the WantRequest nonce. */
  nonce: Uint8Array;
  items: WantResponseItem[];
}

export interface Cancel {
  kind: 'CANCEL';
  /** Nonce of a prior WantRequest to cancel. */
  nonce: Uint8Array;
}

export type SwarmMessage = HaveAnnounce | WantRequest | WantResponse | Cancel;

// ─── Limits (BITSWAP.md §Flow control) ─────────────────────────────────────

export const SWARM_MAX_HAVE_BATCH = 256;             // entries per HAVE_ANNOUNCE
export const SWARM_HAVE_DEBOUNCE_MS = 500;           // delta announce debounce
export const SWARM_MAX_CONCURRENT_PER_PEER = 8;      // outstanding WANTs per peer
export const SWARM_MAX_WANTS_PER_REQUEST = 16;
export const SWARM_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const SWARM_BYTE_BUDGET_PER_MIN = 10 * 1024 * 1024; // both directions
export const SWARM_RESPONSE_TIMEOUT_MS = 10 * 1000;
export const SWARM_DHT_CACHE_TTL_MS = 5 * 60 * 1000;

// ─── CBOR helpers ───────────────────────────────────────────────────────────
//
// Canonical CBOR maps. Keys sorted lexicographically by the encoder.

export function haveAnnounceToCborMap(a: HaveAnnounce): Record<string, unknown> {
  return {
    kind: a.kind,
    nodeId: a.nodeId,
    additions: a.additions,
    removals: a.removals,
    ts: a.ts,
    sig: a.sig,
  };
}

export function haveAnnounceToUnsignedCborMap(a: HaveAnnounce): Record<string, unknown> {
  return {
    kind: a.kind,
    nodeId: a.nodeId,
    additions: a.additions,
    removals: a.removals,
    ts: a.ts,
  };
}

export function haveAnnounceFromCborMap(m: Record<string, unknown>): HaveAnnounce {
  if (m.kind !== 'HAVE_ANNOUNCE') throw new Error('swarm: not a HAVE_ANNOUNCE');
  return {
    kind: 'HAVE_ANNOUNCE',
    nodeId: asBytes(m.nodeId, 'nodeId'),
    additions: asByteList(m.additions, 'additions'),
    removals: asByteList(m.removals, 'removals'),
    ts: asNumber(m.ts, 'ts'),
    sig: asBytes(m.sig, 'sig'),
  };
}

export function wantRequestToCborMap(r: WantRequest): Record<string, unknown> {
  return {
    kind: r.kind,
    nonce: r.nonce,
    wants: r.wants.map((w) => {
      const out: Record<string, unknown> = {
        id: w.id,
        kind: w.kind,
        withProof: w.withProof,
      };
      if (w.maxBytes !== undefined) out.maxBytes = w.maxBytes;
      return out;
    }),
  };
}

export function wantRequestFromCborMap(m: Record<string, unknown>): WantRequest {
  if (m.kind !== 'WANT_REQUEST') throw new Error('swarm: not a WANT_REQUEST');
  const wantsRaw = m.wants;
  if (!Array.isArray(wantsRaw)) throw new Error('swarm: wants not an array');
  const wants: WantItem[] = wantsRaw.map((w, i) => {
    if (typeof w !== 'object' || w === null) throw new Error(`swarm: wants[${i}] not a map`);
    const wm = w as Record<string, unknown>;
    const kind = wm.kind;
    if (kind !== 'piece' && kind !== 'chunk' && kind !== 'blob' && kind !== 'op') {
      throw new Error(`swarm: wants[${i}].kind invalid`);
    }
    const item: WantItem = {
      id: asBytes(wm.id, `wants[${i}].id`),
      kind,
      withProof: wm.withProof === true,
    };
    if (typeof wm.maxBytes === 'number') item.maxBytes = wm.maxBytes;
    return item;
  });
  return {
    kind: 'WANT_REQUEST',
    nonce: asBytes(m.nonce, 'nonce'),
    wants,
  };
}

export function wantResponseToCborMap(r: WantResponse): Record<string, unknown> {
  return {
    kind: r.kind,
    nonce: r.nonce,
    items: r.items.map((it) => {
      const out: Record<string, unknown> = {
        id: it.id,
        outcome: it.outcome,
      };
      if (it.bytes) out.bytes = it.bytes;
      if (it.proof) out.proof = it.proof;
      if (it.blobRoot) out.blobRoot = it.blobRoot;
      if (it.pieceIdx !== undefined) out.pieceIdx = it.pieceIdx;
      if (it.totalPieces !== undefined) out.totalPieces = it.totalPieces;
      return out;
    }),
  };
}

export function wantResponseFromCborMap(m: Record<string, unknown>): WantResponse {
  if (m.kind !== 'WANT_RESPONSE') throw new Error('swarm: not a WANT_RESPONSE');
  const raw = m.items;
  if (!Array.isArray(raw)) throw new Error('swarm: items not an array');
  const items: WantResponseItem[] = raw.map((it, i) => {
    if (typeof it !== 'object' || it === null) throw new Error(`swarm: items[${i}] not a map`);
    const im = it as Record<string, unknown>;
    const oc = im.outcome;
    if (oc !== 'bytes' && oc !== 'notHave' && oc !== 'tooBig' && oc !== 'rateLimited') {
      throw new Error(`swarm: items[${i}].outcome invalid`);
    }
    const out: WantResponseItem = {
      id: asBytes(im.id, `items[${i}].id`),
      outcome: oc,
    };
    if (im.bytes !== undefined) out.bytes = asBytes(im.bytes, `items[${i}].bytes`);
    if (im.proof !== undefined) out.proof = asByteList(im.proof, `items[${i}].proof`);
    if (im.blobRoot !== undefined) out.blobRoot = asBytes(im.blobRoot, `items[${i}].blobRoot`);
    if (typeof im.pieceIdx === 'number') out.pieceIdx = im.pieceIdx;
    if (typeof im.totalPieces === 'number') out.totalPieces = im.totalPieces;
    return out;
  });
  return { kind: 'WANT_RESPONSE', nonce: asBytes(m.nonce, 'nonce'), items };
}

export function cancelToCborMap(c: Cancel): Record<string, unknown> {
  return { kind: c.kind, nonce: c.nonce };
}

export function cancelFromCborMap(m: Record<string, unknown>): Cancel {
  if (m.kind !== 'CANCEL') throw new Error('swarm: not a CANCEL');
  return { kind: 'CANCEL', nonce: asBytes(m.nonce, 'nonce') };
}

/** Decode any swarm message by inspecting its `kind` field. */
export function swarmMessageFromCborMap(m: Record<string, unknown>): SwarmMessage {
  switch (m.kind) {
    case 'HAVE_ANNOUNCE': return haveAnnounceFromCborMap(m);
    case 'WANT_REQUEST': return wantRequestFromCborMap(m);
    case 'WANT_RESPONSE': return wantResponseFromCborMap(m);
    case 'CANCEL': return cancelFromCborMap(m);
    default: throw new Error(`swarm: unknown kind '${String(m.kind)}'`);
  }
}

// ─── Internal validation helpers ───────────────────────────────────────────

function asBytes(v: unknown, label: string): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v) && v.every((b) => typeof b === 'number')) return new Uint8Array(v);
  throw new Error(`swarm: ${label} not bytes`);
}

function asByteList(v: unknown, label: string): Uint8Array[] {
  if (!Array.isArray(v)) throw new Error(`swarm: ${label} not an array`);
  return v.map((b, i) => asBytes(b, `${label}[${i}]`));
}

function asNumber(v: unknown, label: string): number {
  if (typeof v === 'number') return v;
  throw new Error(`swarm: ${label} not a number`);
}
