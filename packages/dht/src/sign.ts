/**
 * @muster/dht — record signing + verification (R25 / Phase 6).
 *
 * Records carry an Ed25519 signature over canonical CBOR of the unsigned
 * fields. Receivers MUST verify before storing / forwarding.
 */

import { encodeCanonical, sha256, sign as ed25519Sign, verify as ed25519Verify } from '@muster/crypto';
import {
  KAD_KEY_BYTES,
  KAD_NODE_ID_BYTES,
  KAD_PUBKEY_BYTES,
  KAD_SIG_BYTES,
  KAD_RECORD_CLOCK_SKEW_MS,
  type DhtRecord,
  type RecordKind,
} from './types.js';
import { recordToUnsignedCborMap } from './cbor.js';

/** Build a record and sign it with the provider's private key. */
export async function buildSignedRecord(args: {
  key: Uint8Array;
  kind: RecordKind;
  providerPubkey: Uint8Array;
  providerPrivkey: Uint8Array;
  wsUrl: string;
  ts: number;
  ttlMs: number;
}): Promise<DhtRecord> {
  if (args.key.length !== KAD_KEY_BYTES) throw new Error('dht: bad key length');
  if (args.providerPubkey.length !== KAD_PUBKEY_BYTES) throw new Error('dht: bad pubkey length');
  const unsigned: DhtRecord = {
    key: args.key,
    kind: args.kind,
    providerPubkey: args.providerPubkey,
    wsUrl: args.wsUrl,
    ts: args.ts,
    ttlMs: args.ttlMs,
    sig: new Uint8Array(KAD_SIG_BYTES),
  };
  const signedBytes = encodeCanonical(recordToUnsignedCborMap(unsigned) as any);
  const sig = await ed25519Sign(signedBytes, args.providerPrivkey);
  return { ...unsigned, sig };
}

/**
 * Verify a record:
 *   - sig is 64 bytes
 *   - ts within ±KAD_RECORD_CLOCK_SKEW_MS of now
 *   - Ed25519 verify against providerPubkey
 *   - record not expired (ts + ttlMs > now)
 */
export async function verifyRecord(r: DhtRecord, now = Date.now()): Promise<boolean> {
  if (r.sig.length !== KAD_SIG_BYTES) return false;
  if (r.providerPubkey.length !== KAD_PUBKEY_BYTES) return false;
  if (r.key.length !== KAD_KEY_BYTES) return false;
  if (r.ttlMs <= 0) return false;
  if (Math.abs(r.ts - now) > KAD_RECORD_CLOCK_SKEW_MS) return false;
  if (r.ts + r.ttlMs <= now) return false;
  try {
    const signedBytes = encodeCanonical(recordToUnsignedCborMap(r) as any);
    return await ed25519Verify(r.sig, signedBytes, r.providerPubkey);
  } catch {
    return false;
  }
}

/** Derive the 32-byte nodeId and 20-byte routing key from an Ed25519 pubkey. */
export function deriveNodeIds(pubkey: Uint8Array): { nodeId: Uint8Array; nodeId160: Uint8Array } {
  if (pubkey.length !== KAD_PUBKEY_BYTES) throw new Error('dht: bad pubkey length');
  const h = sha256(pubkey);
  if (h.length !== KAD_NODE_ID_BYTES) throw new Error('dht: sha256 length unexpected');
  return { nodeId: h, nodeId160: h.slice(0, KAD_KEY_BYTES) };
}

/** Derive a 160-bit Kad key from a kind prefix + 32-byte content id. */
export function deriveContentKey(prefix: 'community' | 'piece' | 'inbox', id: Uint8Array): Uint8Array {
  // INBOX_ROUTE: per spec the inbox hash itself is 32 bytes; truncate to 20.
  if (prefix === 'inbox') return sha256(id).slice(0, KAD_KEY_BYTES);
  const prefBytes = new TextEncoder().encode(prefix);
  const buf = new Uint8Array(prefBytes.length + id.length);
  buf.set(prefBytes, 0);
  buf.set(id, prefBytes.length);
  return sha256(buf).slice(0, KAD_KEY_BYTES);
}
