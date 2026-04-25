/**
 * @muster/dht — k-bucket routing table (R25 / Phase 6).
 *
 * Standard Kademlia: 160 buckets indexed by common-prefix length to the
 * local node id. Each bucket holds up to k contacts ordered by recency
 * (LRU eviction).
 *
 * Bucket selection rule for a target id:
 *   bucket_index = commonPrefixLen(localId, targetId)
 *
 * On contact insertion:
 *   - already present → move to tail (mark recently seen)
 *   - room available → append to tail
 *   - bucket full → ping the LRU contact; if alive, drop the new one;
 *                   if dead, evict and append. (Phase-6 MVP: drop new
 *                   without ping; ping-eviction is a follow-up.)
 */

import { commonPrefixLen, sortByDistance, xor, compareDistance } from './distance.js';
import { KAD_K, KAD_KEY_BITS, type Contact } from './types.js';

interface Bucket {
  contacts: Contact[];
  lastRefreshedAt: number;
}

export class RoutingTable {
  private buckets: Bucket[];
  /** Bytes of the local 160-bit routing id. */
  readonly localId: Uint8Array;

  constructor(localId: Uint8Array) {
    if (localId.length !== KAD_KEY_BITS / 8) {
      throw new Error(`dht: localId must be ${KAD_KEY_BITS / 8} bytes`);
    }
    this.localId = localId;
    this.buckets = Array.from({ length: KAD_KEY_BITS }, () => ({ contacts: [], lastRefreshedAt: Date.now() }));
  }

  // ── Insert ───────────────────────────────────────────────────────────────

  /** Add or refresh a contact. Returns true when stored, false on bucket full. */
  add(contact: Contact): boolean {
    if (eqBytes(contact.nodeId160, this.localId)) return false;
    const idx = bucketIndex(this.localId, contact.nodeId160);
    const b = this.buckets[idx]!;
    const existing = b.contacts.findIndex((c) => eqBytes(c.nodeId160, contact.nodeId160));
    if (existing >= 0) {
      // Move to tail with refreshed lastSeen.
      const [old] = b.contacts.splice(existing, 1);
      b.contacts.push({ ...old!, ...contact, lastSeen: Math.max(old!.lastSeen, contact.lastSeen) });
      return true;
    }
    if (b.contacts.length < KAD_K) {
      b.contacts.push(contact);
      return true;
    }
    // Bucket full: MVP drops the newcomer. A future revision can ping
    // the LRU and evict on timeout.
    return false;
  }

  remove(nodeId160: Uint8Array): boolean {
    for (const b of this.buckets) {
      const i = b.contacts.findIndex((c) => eqBytes(c.nodeId160, nodeId160));
      if (i >= 0) { b.contacts.splice(i, 1); return true; }
    }
    return false;
  }

  // ── Lookup ───────────────────────────────────────────────────────────────

  /** Return up to k contacts closest to `target`, sorted by XOR distance. */
  closest(target: Uint8Array, max = KAD_K): Contact[] {
    const all: Contact[] = [];
    for (const b of this.buckets) all.push(...b.contacts);
    sortByDistance(all, target);
    return all.slice(0, max);
  }

  /** All contacts in the table — used for replication sweeps. */
  allContacts(): Contact[] {
    const out: Contact[] = [];
    for (const b of this.buckets) out.push(...b.contacts);
    return out;
  }

  size(): number {
    let n = 0;
    for (const b of this.buckets) n += b.contacts.length;
    return n;
  }

  /** True when the local table has no peers — useful for "needs bootstrap" checks. */
  isEmpty(): boolean {
    return this.size() === 0;
  }

  // ── Refresh tracking ─────────────────────────────────────────────────────

  /** Mark a bucket as refreshed (called after a successful FIND_NODE in it). */
  markRefreshed(idx: number, now = Date.now()): void {
    const b = this.buckets[idx];
    if (b) b.lastRefreshedAt = now;
  }

  /** Index of every bucket whose lastRefreshedAt is older than threshold. */
  staleBuckets(thresholdMs: number, now = Date.now()): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.buckets.length; i++) {
      const b = this.buckets[i]!;
      if (b.contacts.length > 0 && now - b.lastRefreshedAt > thresholdMs) out.push(i);
    }
    return out;
  }

  /** Bucket index a contact would land in, given the local id. */
  bucketFor(nodeId160: Uint8Array): number {
    return bucketIndex(this.localId, nodeId160);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function bucketIndex(localId: Uint8Array, otherId: Uint8Array): number {
  const cpl = commonPrefixLen(localId, otherId);
  if (cpl >= KAD_KEY_BITS) return KAD_KEY_BITS - 1; // self — clamp; caller usually skips this
  return cpl;
}

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Re-export so consumers pick up via the routing table module. */
export { compareDistance, xor };
