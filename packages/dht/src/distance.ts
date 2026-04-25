/**
 * @muster/dht — XOR distance helpers (R25 / Phase 6).
 *
 * Standard Kademlia metric. Bit-level helpers for routing-table bucket
 * placement (common-prefix length).
 */

import { KAD_KEY_BITS, KAD_KEY_BYTES } from './types.js';

/** XOR two equal-length byte arrays. */
export function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) throw new Error(`dht: xor length mismatch ${a.length} vs ${b.length}`);
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] ?? 0) ^ (b[i] ?? 0);
  return out;
}

/**
 * Common-prefix-length in bits between two 160-bit ids. Returns
 * KAD_KEY_BITS when the ids are equal. Used to pick the k-bucket index.
 */
export function commonPrefixLen(a: Uint8Array, b: Uint8Array): number {
  const x = xor(a, b);
  let cpl = 0;
  for (let i = 0; i < x.length; i++) {
    const byte = x[i] ?? 0;
    if (byte === 0) { cpl += 8; continue; }
    // first 1-bit position from MSB
    for (let bit = 7; bit >= 0; bit--) {
      if ((byte >> bit) & 1) return cpl;
      cpl += 1;
    }
    return cpl;
  }
  return KAD_KEY_BITS;
}

/**
 * Byte-wise lexicographic compare of XOR distance — used to sort
 * candidate contacts during iterative lookup. Returns -1 / 0 / 1.
 */
export function compareDistance(d1: Uint8Array, d2: Uint8Array): number {
  for (let i = 0; i < d1.length; i++) {
    const a = d1[i] ?? 0;
    const b = d2[i] ?? 0;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

/** Sort contacts ascending by XOR distance to target (in place). */
export function sortByDistance<T extends { nodeId160: Uint8Array }>(
  arr: T[],
  target: Uint8Array,
): T[] {
  return arr.sort((a, b) => compareDistance(xor(a.nodeId160, target), xor(b.nodeId160, target)));
}

/** True when a is strictly closer to target than b. */
export function isCloser(a: Uint8Array, b: Uint8Array, target: Uint8Array): boolean {
  return compareDistance(xor(a, target), xor(b, target)) < 0;
}

/** Length sanity check. */
export function assertKeyLen(k: Uint8Array, label = 'key'): void {
  if (k.length !== KAD_KEY_BYTES) {
    throw new Error(`dht: ${label} must be ${KAD_KEY_BYTES} bytes, got ${k.length}`);
  }
}
