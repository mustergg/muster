/**
 * @muster/protocol/dm — Sealed-sender DM routing (R25 / Phase 8).
 *
 * Spec: docs/specs/DM.md.
 *
 * Wire framing (rides peerManager's existing peer WS — also used by
 * browser clients for their own subscribe/publish flows):
 *   { type: 'DM_FRAME', payload: { cbor: base64(canonicalCBOR(DmFrame)) } }
 *
 * Sender→relay subscription/publish are handled by the relay-side DM
 * routing layer, not in this codec; this file only defines the DmFrame
 * wire envelope plus padding-bucket helpers.
 *
 * Privacy guarantees come from the inbox hash (see
 * `@muster/crypto/e2e:inboxHash`). The frame itself carries:
 *
 *   - inboxHash (recipient's rotating address)
 *   - sender's ephemeral X25519 pubkey
 *   - AES-GCM nonce + ciphertext
 *   - random padding to one of {512, 1024, 2048, 4096}-byte buckets
 *
 * The plaintext sender pubkey is **not** present — it is recovered from
 * the decrypted DmPayload after the recipient performs ECDH.
 */

// ─── Constants ─────────────────────────────────────────────────────────────

export const DM_V = 1;

export const DM_INBOX_BYTES = 32;
export const DM_EPHEM_PUB_BYTES = 32;
export const DM_NONCE_BYTES = 12;
/** AES-GCM tag (16 bytes) + nonce (12) — overhead reserved when sizing buckets. */
export const DM_AEAD_OVERHEAD = 16 + DM_NONCE_BYTES;

/** Padding buckets per DM.md §Padding. Ordered ascending. */
export const DM_PADDING_BUCKETS: ReadonlyArray<number> = [512, 1024, 2048, 4096];

/** Hard upper bound on a single DM frame's ciphertext (incl. padding). */
export const DM_MAX_CIPHERTEXT_BYTES = DM_PADDING_BUCKETS[DM_PADDING_BUCKETS.length - 1]!;

/** Per-relay rate limits per inbox hash (DM.md §Rate limits). */
export const DM_RATE_FRAMES_PER_MINUTE = 10;
export const DM_RATE_ORPHAN_LIMIT = 50;

/** Orphan retention + retry cadence (DM.md §Routing). */
export const DM_ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;
export const DM_ORPHAN_RETRY_INTERVAL_MS = 15 * 60 * 1000;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DmFrame {
  /** Spec version. Always 1 in this MVP. */
  v: number;
  /** 32-byte rotating inbox hash. */
  inboxHash: Uint8Array;
  /** 32-byte sender ephemeral X25519 pubkey. */
  senderEphemeralPub: Uint8Array;
  /** 12-byte AES-GCM nonce. */
  nonce: Uint8Array;
  /** AEAD ciphertext (sealed canonical-CBOR DmPayload). */
  ciphertext: Uint8Array;
  /** Sender wall-clock ms; recipient checks against own ts ±5min. */
  ts: number;
  /** Random padding chosen so ciphertext lands in a bucket. */
  padding: Uint8Array;
}

// ─── Padding helpers ───────────────────────────────────────────────────────

/**
 * Pick the smallest bucket that fits `ciphertextLen + DM_AEAD_OVERHEAD`.
 * Returns null when the message is too large — caller MUST send it as a
 * blob body (see DM.md §Padding).
 */
export function pickDmBucket(ciphertextLen: number): number | null {
  const target = ciphertextLen + DM_AEAD_OVERHEAD;
  for (const b of DM_PADDING_BUCKETS) {
    if (b >= target) return b;
  }
  return null;
}

/** Number of random padding bytes to append given a chosen bucket. */
export function dmPaddingLen(ciphertextLen: number, bucket: number): number {
  const padded = bucket - ciphertextLen - DM_AEAD_OVERHEAD;
  return Math.max(0, padded);
}

// ─── CBOR codec ────────────────────────────────────────────────────────────
//
// Canonical-CBOR serialisation: deterministic key order, every value
// either Uint8Array, number, or string. We emit a Map (Record) — the
// canonical encoder in `@muster/crypto:encodeCanonical` already sorts
// keys lexicographically.

export function dmFrameToCborMap(f: DmFrame): Record<string, unknown> {
  return {
    v: f.v,
    inboxHash: f.inboxHash,
    senderEphemeralPub: f.senderEphemeralPub,
    nonce: f.nonce,
    ciphertext: f.ciphertext,
    ts: f.ts,
    padding: f.padding,
  };
}

export function dmFrameFromCborMap(m: Record<string, unknown>): DmFrame {
  const v = m.v as number;
  if (v !== DM_V) throw new Error(`dm: unsupported version ${v}`);
  const inboxHash = asBytes(m.inboxHash, 'inboxHash', DM_INBOX_BYTES);
  const senderEphemeralPub = asBytes(m.senderEphemeralPub, 'senderEphemeralPub', DM_EPHEM_PUB_BYTES);
  const nonce = asBytes(m.nonce, 'nonce', DM_NONCE_BYTES);
  const ciphertext = asBytes(m.ciphertext, 'ciphertext');
  const padding = asBytes(m.padding, 'padding');
  const ts = m.ts as number;
  if (!Number.isFinite(ts)) throw new Error('dm: ts must be a finite number');
  return { v, inboxHash, senderEphemeralPub, nonce, ciphertext, ts, padding };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function asBytes(v: unknown, name: string, expectLen?: number): Uint8Array {
  if (v instanceof Uint8Array) {
    if (expectLen !== undefined && v.length !== expectLen) {
      throw new Error(`dm: ${name} expected ${expectLen} bytes, got ${v.length}`);
    }
    return v;
  }
  if (typeof Buffer !== 'undefined' && v instanceof Buffer) {
    const u = new Uint8Array(v);
    if (expectLen !== undefined && u.length !== expectLen) {
      throw new Error(`dm: ${name} expected ${expectLen} bytes, got ${u.length}`);
    }
    return u;
  }
  throw new Error(`dm: ${name} must be bytes`);
}
