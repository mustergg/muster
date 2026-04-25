/**
 * @muster/protocol/pos — Proof-of-Storage challenges (R25 / Phase 7).
 *
 * Spec: docs/specs/POS.md.
 *
 * Wire framing (rides peerManager's existing peer WS):
 *   { type: 'POS', payload: { cbor: base64(canonicalCBOR(PosMessage)) } }
 *
 * Challenges and responses ride the same frame; receiver dispatches by
 * `kind`.
 */

// ─── Constants ─────────────────────────────────────────────────────────────

export const POS_NONCE_BYTES = 16;
export const POS_TARGET_BYTES = 32;
export const POS_DIGEST_BYTES = 32;
export const POS_SIG_BYTES = 64;

/** 5 KB base + up to 1 KB jitter, clamped to target size. */
export const POS_WINDOW_BASE = 5 * 1024;
export const POS_WINDOW_JITTER_MAX = 1024;

/** Respondent has 5 s to reply. */
export const POS_RESPONSE_TIMEOUT_MS = 5_000;

/** Issuer rate-limit per peer per hour. */
export const POS_MAX_CHALLENGES_PER_HOUR = 20;

// ─── Types ─────────────────────────────────────────────────────────────────

export type PosTargetKind = 'piece' | 'chunk' | 'op';
export type PosMessageKind = 'POS_CHALLENGE' | 'POS_RESPONSE';

export interface PosChallenge {
  kind: 'POS_CHALLENGE';
  /** 16 bytes. Matches its eventual response. */
  nonce: Uint8Array;
  /** 32 bytes — pieceId, chunkId, or opId claimed in HAVE. */
  target: Uint8Array;
  targetKind: PosTargetKind;
  /** Inclusive byte offset. */
  offsetStart: number;
  /** Exclusive. window = offsetEnd - offsetStart, ~5 KB ± jitter. */
  offsetEnd: number;
  /** Wall-clock ms; receiver can reject stale challenges. */
  ts: number;
  /** 64 bytes Ed25519 over canonicalCBOR(challenge \ sig). MVP allows
   *  zero-bytes (peer connection already authenticated). */
  sig: Uint8Array;
}

export interface PosResponse {
  kind: 'POS_RESPONSE';
  /** Echo of the challenge nonce. */
  nonce: Uint8Array;
  /** 32 bytes — see POS.md §Response digest:
   *    SHA-256(target || u32_be(offsetStart) || u32_be(offsetEnd)
   *            || nonce || content[offsetStart..offsetEnd]). */
  digest: Uint8Array;
}

export type PosMessage = PosChallenge | PosResponse;

// ─── CBOR codecs ───────────────────────────────────────────────────────────

export function posChallengeToCborMap(c: PosChallenge): Record<string, unknown> {
  return {
    kind: c.kind,
    nonce: c.nonce,
    target: c.target,
    targetKind: c.targetKind,
    offsetStart: c.offsetStart,
    offsetEnd: c.offsetEnd,
    ts: c.ts,
    sig: c.sig,
  };
}

/** Same minus `sig` — used as the signing payload. */
export function posChallengeToUnsignedCborMap(c: PosChallenge): Record<string, unknown> {
  return {
    kind: c.kind,
    nonce: c.nonce,
    target: c.target,
    targetKind: c.targetKind,
    offsetStart: c.offsetStart,
    offsetEnd: c.offsetEnd,
    ts: c.ts,
  };
}

export function posChallengeFromCborMap(m: Record<string, unknown>): PosChallenge {
  if (m.kind !== 'POS_CHALLENGE') throw new Error('pos: not a POS_CHALLENGE');
  const tk = m.targetKind;
  if (tk !== 'piece' && tk !== 'chunk' && tk !== 'op') {
    throw new Error('pos: invalid targetKind');
  }
  return {
    kind: 'POS_CHALLENGE',
    nonce: asBytes(m.nonce, 'nonce'),
    target: asBytes(m.target, 'target'),
    targetKind: tk,
    offsetStart: asNumber(m.offsetStart, 'offsetStart'),
    offsetEnd: asNumber(m.offsetEnd, 'offsetEnd'),
    ts: asNumber(m.ts, 'ts'),
    sig: asBytes(m.sig, 'sig'),
  };
}

export function posResponseToCborMap(r: PosResponse): Record<string, unknown> {
  return {
    kind: r.kind,
    nonce: r.nonce,
    digest: r.digest,
  };
}

export function posResponseFromCborMap(m: Record<string, unknown>): PosResponse {
  if (m.kind !== 'POS_RESPONSE') throw new Error('pos: not a POS_RESPONSE');
  return {
    kind: 'POS_RESPONSE',
    nonce: asBytes(m.nonce, 'nonce'),
    digest: asBytes(m.digest, 'digest'),
  };
}

export function posMessageToCborMap(msg: PosMessage): Record<string, unknown> {
  switch (msg.kind) {
    case 'POS_CHALLENGE': return posChallengeToCborMap(msg);
    case 'POS_RESPONSE':  return posResponseToCborMap(msg);
  }
}

export function posMessageFromCborMap(m: Record<string, unknown>): PosMessage {
  switch (m.kind) {
    case 'POS_CHALLENGE': return posChallengeFromCborMap(m);
    case 'POS_RESPONSE':  return posResponseFromCborMap(m);
    default: throw new Error(`pos: unknown kind '${String(m.kind)}'`);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function asBytes(v: unknown, label: string): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v) && v.every((b) => typeof b === 'number')) return new Uint8Array(v);
  throw new Error(`pos: ${label} not bytes`);
}

function asNumber(v: unknown, label: string): number {
  if (typeof v === 'number') return v;
  throw new Error(`pos: ${label} not a number`);
}
