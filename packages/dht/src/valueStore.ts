/**
 * @muster/dht — local record store (R25 / Phase 6).
 *
 * In-memory value table holding signed records this node serves on
 * FIND_VALUE. Indexed by the 20-byte Kad key. Per-(key, providerPubkey)
 * cap of KAD_MAX_RECORDS_PER_KEY_PROVIDER so a single bad actor cannot
 * monopolise a key's providers list.
 *
 * Records are evicted on TTL expiry (see verifyRecord — `ts + ttlMs`).
 * Sweep periodically via `gcExpired`.
 */

import {
  KAD_MAX_RECORDS_PER_KEY_PROVIDER,
  type DhtRecord,
} from './types.js';

function keyHex(k: Uint8Array): string {
  let s = '';
  for (let i = 0; i < k.length; i++) s += (k[i]! < 16 ? '0' : '') + k[i]!.toString(16);
  return s;
}
function pubHex(p: Uint8Array): string {
  let s = '';
  for (let i = 0; i < p.length; i++) s += (p[i]! < 16 ? '0' : '') + p[i]!.toString(16);
  return s;
}

interface Entry {
  record: DhtRecord;
  /** When we received it locally (independent of `record.ts`). */
  storedAt: number;
}

export class ValueStore {
  /** keyHex → providerHex → list of records (newest last). */
  private store = new Map<string, Map<string, Entry[]>>();

  /** Insert or refresh. Returns true when stored. Enforces per-provider cap. */
  put(record: DhtRecord, now = Date.now()): boolean {
    const kHex = keyHex(record.key);
    const pHex = pubHex(record.providerPubkey);
    let byProvider = this.store.get(kHex);
    if (!byProvider) {
      byProvider = new Map();
      this.store.set(kHex, byProvider);
    }
    const list = byProvider.get(pHex) ?? [];
    // De-dup if the same record (by ts) already there — refresh storedAt.
    const dup = list.find((e) => e.record.ts === record.ts);
    if (dup) { dup.storedAt = now; return false; }
    list.push({ record, storedAt: now });
    if (list.length > KAD_MAX_RECORDS_PER_KEY_PROVIDER) {
      list.sort((a, b) => a.record.ts - b.record.ts);
      list.splice(0, list.length - KAD_MAX_RECORDS_PER_KEY_PROVIDER);
    }
    byProvider.set(pHex, list);
    return true;
  }

  /** Return all unexpired records for `key` across providers. */
  get(key: Uint8Array, now = Date.now()): DhtRecord[] {
    const byProvider = this.store.get(keyHex(key));
    if (!byProvider) return [];
    const out: DhtRecord[] = [];
    for (const list of byProvider.values()) {
      for (const e of list) {
        if (e.record.ts + e.record.ttlMs > now) out.push(e.record);
      }
    }
    return out;
  }

  /** Sweep expired records. Returns number removed. */
  gcExpired(now = Date.now()): number {
    let removed = 0;
    for (const [k, byProvider] of this.store) {
      for (const [p, list] of byProvider) {
        const fresh = list.filter((e) => e.record.ts + e.record.ttlMs > now);
        removed += list.length - fresh.length;
        if (fresh.length === 0) byProvider.delete(p);
        else byProvider.set(p, fresh);
      }
      if (byProvider.size === 0) this.store.delete(k);
    }
    return removed;
  }

  /** All records stored — used for replication sweeps. */
  allRecords(): DhtRecord[] {
    const out: DhtRecord[] = [];
    for (const byProvider of this.store.values()) {
      for (const list of byProvider.values()) {
        for (const e of list) out.push(e.record);
      }
    }
    return out;
  }

  stats(): { keyCount: number; recordCount: number } {
    let n = 0;
    for (const byProvider of this.store.values()) {
      for (const list of byProvider.values()) n += list.length;
    }
    return { keyCount: this.store.size, recordCount: n };
  }
}
