/**
 * @muster/dht — DhtNode (R25 / Phase 6).
 *
 * Owns the routing table + value store. Drives iterative lookups
 * (FIND_NODE / FIND_VALUE) via an injected transport. Receives inbound
 * RPCs through `handleMessage`.
 *
 * The transport abstraction keeps this package free of any WebSocket
 * library — the relay supplies a `DhtTransport` wired to its existing
 * peer connections (see `apps/relay/src/dhtHandler.ts`).
 */

import { randomBytes } from 'crypto';
import { verify as ed25519Verify } from '@muster/crypto';
import {
  KAD_ALPHA,
  KAD_K,
  KAD_KEY_BITS,
  KAD_KEY_BYTES,
  KAD_NONCE_BYTES,
  KAD_RPC_TIMEOUT_MS,
  KAD_TTL_MS,
  type Contact,
  type DhtFindNode,
  type DhtFindNodeResp,
  type DhtFindValue,
  type DhtFindValueResp,
  type DhtMessage,
  type DhtPing,
  type DhtPong,
  type DhtRecord,
  type DhtStore,
  type DhtStoreAck,
} from './types.js';
import { RoutingTable, bucketIndex } from './routingTable.js';
import { ValueStore } from './valueStore.js';
import { compareDistance, sortByDistance, xor } from './distance.js';
import { buildSignedRecord, deriveNodeIds, verifyRecord } from './sign.js';

/**
 * Pluggable transport. Implementations:
 *   - relay: maps `nodeId` (32 bytes) → existing peer WS via peerManager
 *   - tests: in-memory direct dispatch
 */
export interface DhtTransport {
  /** Send a DHT message to the peer identified by `nodeId`. Returns
   *  false when no live connection exists. */
  send(toNodeId: Uint8Array, msg: DhtMessage): boolean;
}

/** Node identity material the DhtNode owns. */
export interface DhtNodeIdentity {
  pubkey: Uint8Array;   // 32 bytes
  privkey: Uint8Array;  // 32 / 64 bytes (passed to @muster/crypto/sign)
  wsUrl: string;
}

interface PendingRpc {
  resolve: (msg: DhtMessage) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class DhtNode {
  readonly identity: DhtNodeIdentity;
  readonly nodeId: Uint8Array;
  readonly nodeId160: Uint8Array;
  readonly table: RoutingTable;
  readonly store = new ValueStore();
  private transport: DhtTransport;

  /** nonceHex → resolver waiting for matching response. */
  private pending = new Map<string, PendingRpc>();

  constructor(identity: DhtNodeIdentity, transport: DhtTransport) {
    this.identity = identity;
    const ids = deriveNodeIds(identity.pubkey);
    this.nodeId = ids.nodeId;
    this.nodeId160 = ids.nodeId160;
    this.table = new RoutingTable(this.nodeId160);
    this.transport = transport;
  }

  // ── Self-as-Contact ──────────────────────────────────────────────────────

  selfContact(): Contact {
    return {
      nodeId: this.nodeId,
      nodeId160: this.nodeId160,
      pubkey: this.identity.pubkey,
      wsUrl: this.identity.wsUrl,
      lastSeen: Date.now(),
    };
  }

  // ── Inbound dispatch ─────────────────────────────────────────────────────

  /** Called by the transport when a DHT message arrives from `from`. */
  async handleMessage(from: Contact, msg: DhtMessage): Promise<void> {
    // Refresh sender in our table.
    this.table.add({ ...from, lastSeen: Date.now() });

    // Match resolvable responses first.
    const nonceHex = bytesHex(msg.nonce);
    const pending = this.pending.get(nonceHex);
    if (pending && (msg.kind === 'PONG' || msg.kind === 'FIND_NODE_RESP'
                    || msg.kind === 'FIND_VALUE_RESP' || msg.kind === 'STORE_ACK')) {
      this.pending.delete(nonceHex);
      clearTimeout(pending.timer);
      pending.resolve(msg);
      return;
    }

    // Otherwise treat as an inbound request.
    switch (msg.kind) {
      case 'PING': {
        const pong: DhtPong = { kind: 'PONG', nonce: msg.nonce };
        this.transport.send(from.nodeId, pong);
        return;
      }
      case 'FIND_NODE': {
        const closest = this.table.closest(msg.target, KAD_K);
        const resp: DhtFindNodeResp = {
          kind: 'FIND_NODE_RESP',
          contacts: closest,
          nonce: msg.nonce,
        };
        this.transport.send(from.nodeId, resp);
        return;
      }
      case 'FIND_VALUE': {
        const records = this.store.get(msg.key);
        const resp: DhtFindValueResp = records.length > 0
          ? { kind: 'FIND_VALUE_RESP', found: records, closerContacts: null, nonce: msg.nonce }
          : { kind: 'FIND_VALUE_RESP', found: null, closerContacts: this.table.closest(msg.key, KAD_K), nonce: msg.nonce };
        this.transport.send(from.nodeId, resp);
        return;
      }
      case 'STORE': {
        const ok = await verifyRecord(msg.value);
        if (ok) this.store.put(msg.value);
        const ack: DhtStoreAck = { kind: 'STORE_ACK', accepted: ok, nonce: msg.nonce };
        this.transport.send(from.nodeId, ack);
        return;
      }
      default:
        // Stray response with no matching pending — ignore.
        return;
    }
  }

  // ── Outbound RPCs ────────────────────────────────────────────────────────

  /** Issue a single PING. Resolves true on PONG, false on timeout. */
  async ping(contact: Contact): Promise<boolean> {
    const nonce = randomBytes(KAD_NONCE_BYTES);
    const msg: DhtPing = { kind: 'PING', nonce: new Uint8Array(nonce) };
    const reply = await this.requestReply(contact.nodeId, msg, nonce.toString('hex'));
    return reply !== null && reply.kind === 'PONG';
  }

  /** Issue a FIND_NODE against a single contact. */
  async findNodeOnce(contact: Contact, target: Uint8Array): Promise<Contact[]> {
    const nonce = randomBytes(KAD_NONCE_BYTES);
    const msg: DhtFindNode = { kind: 'FIND_NODE', target, nonce: new Uint8Array(nonce) };
    const reply = await this.requestReply(contact.nodeId, msg, nonce.toString('hex'));
    if (!reply || reply.kind !== 'FIND_NODE_RESP') return [];
    return reply.contacts;
  }

  /** Issue a FIND_VALUE against a single contact. */
  async findValueOnce(contact: Contact, key: Uint8Array): Promise<{ records?: DhtRecord[]; closer?: Contact[] }> {
    const nonce = randomBytes(KAD_NONCE_BYTES);
    const msg: DhtFindValue = { kind: 'FIND_VALUE', key, nonce: new Uint8Array(nonce) };
    const reply = await this.requestReply(contact.nodeId, msg, nonce.toString('hex'));
    if (!reply || reply.kind !== 'FIND_VALUE_RESP') return {};
    const out: { records?: DhtRecord[]; closer?: Contact[] } = {};
    if (reply.found) out.records = reply.found;
    if (reply.closerContacts) out.closer = reply.closerContacts;
    return out;
  }

  /** Send a STORE to a single contact. */
  async storeOnce(contact: Contact, key: Uint8Array, record: DhtRecord): Promise<boolean> {
    const nonce = randomBytes(KAD_NONCE_BYTES);
    const msg: DhtStore = { kind: 'STORE', key, value: record, nonce: new Uint8Array(nonce) };
    const reply = await this.requestReply(contact.nodeId, msg, nonce.toString('hex'));
    return reply !== null && reply.kind === 'STORE_ACK' && reply.accepted === true;
  }

  // ── Iterative lookups ────────────────────────────────────────────────────

  /**
   * Iterative FIND_NODE (`target`). Returns up to k closest contacts
   * across all responses. Marks the bucket containing `target` as
   * refreshed.
   */
  async iterativeFindNode(target: Uint8Array): Promise<Contact[]> {
    const seen = new Set<string>();
    const candidates: Contact[] = this.table.closest(target, KAD_K);
    candidates.forEach((c) => seen.add(bytesHex(c.nodeId160)));

    let progressed = true;
    while (progressed) {
      progressed = false;
      // Pick α closest unqueried.
      const round = candidates.slice(0, KAD_ALPHA);
      const results = await Promise.all(round.map((c) => this.findNodeOnce(c, target)));
      for (const list of results) {
        for (const c of list) {
          if (eqBytes(c.nodeId160, this.nodeId160)) continue;
          const h = bytesHex(c.nodeId160);
          if (seen.has(h)) continue;
          seen.add(h);
          this.table.add(c);
          candidates.push(c);
          progressed = true;
        }
      }
      sortByDistance(candidates, target);
      if (candidates.length > KAD_K) candidates.length = KAD_K;
    }

    this.table.markRefreshed(bucketIndex(this.nodeId160, target));
    return candidates;
  }

  /**
   * Iterative FIND_VALUE. Returns the union of records found across
   * the lookup, deduplicated by (providerPubkey, ts). Stops the
   * branch that returned records (Kademlia "first-found" optimisation
   * adapted for multi-record keys).
   */
  async iterativeFindValue(key: Uint8Array): Promise<DhtRecord[]> {
    if (key.length !== KAD_KEY_BYTES) throw new Error('dht: bad key length');

    // Local store fast-path.
    const local = this.store.get(key);
    if (local.length > 0) return local;

    const seen = new Set<string>();
    const candidates: Contact[] = this.table.closest(key, KAD_K);
    candidates.forEach((c) => seen.add(bytesHex(c.nodeId160)));
    const collected: DhtRecord[] = [];
    const collectedKeys = new Set<string>();

    let progressed = true;
    while (progressed) {
      progressed = false;
      const round = candidates.slice(0, KAD_ALPHA);
      const results = await Promise.all(round.map((c) => this.findValueOnce(c, key)));

      for (const r of results) {
        if (r.records) {
          for (const rec of r.records) {
            const ok = await verifyRecord(rec);
            if (!ok) continue;
            const k = bytesHex(rec.providerPubkey) + ':' + String(rec.ts);
            if (collectedKeys.has(k)) continue;
            collectedKeys.add(k);
            collected.push(rec);
          }
        }
        if (r.closer) {
          for (const c of r.closer) {
            if (eqBytes(c.nodeId160, this.nodeId160)) continue;
            const h = bytesHex(c.nodeId160);
            if (seen.has(h)) continue;
            seen.add(h);
            this.table.add(c);
            candidates.push(c);
            progressed = true;
          }
        }
      }
      sortByDistance(candidates, key);
      if (candidates.length > KAD_K) candidates.length = KAD_K;
      if (collected.length > 0) break;
    }
    return collected;
  }

  // ── Advertise ────────────────────────────────────────────────────────────

  /**
   * STORE a freshly-signed record on the k closest live nodes to `key`.
   * Returns the count of accepting peers.
   */
  async advertise(args: {
    key: Uint8Array;
    kind: DhtRecord['kind'];
    ttlMs?: number;
  }): Promise<number> {
    const closest = await this.iterativeFindNode(args.key);
    const record = await buildSignedRecord({
      key: args.key,
      kind: args.kind,
      providerPubkey: this.identity.pubkey,
      providerPrivkey: this.identity.privkey,
      wsUrl: this.identity.wsUrl,
      ts: Date.now(),
      ttlMs: args.ttlMs ?? KAD_TTL_MS,
    });
    // Keep a copy locally so a FIND_VALUE landing on us can serve it.
    this.store.put(record);
    const acks = await Promise.all(closest.map((c) => this.storeOnce(c, args.key, record).catch(() => false)));
    return acks.filter(Boolean).length;
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────

  /** Seed routing table with the given contacts and self-locate via FIND_NODE(self). */
  async bootstrap(seeds: Contact[]): Promise<void> {
    for (const s of seeds) this.table.add(s);
    if (seeds.length === 0) return;
    await this.iterativeFindNode(this.nodeId160);
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private requestReply(to: Uint8Array, msg: DhtMessage, nonceHex: string): Promise<DhtMessage | null> {
    return new Promise<DhtMessage | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonceHex);
        resolve(null);
      }, KAD_RPC_TIMEOUT_MS);
      this.pending.set(nonceHex, { resolve, timer });
      const ok = this.transport.send(to, msg);
      if (!ok) {
        clearTimeout(timer);
        this.pending.delete(nonceHex);
        resolve(null);
      }
    });
  }

  // ── Diagnostics ──────────────────────────────────────────────────────────

  stats(): { contacts: number; storedRecords: number; pending: number } {
    return {
      contacts: this.table.size(),
      storedRecords: this.store.stats().recordCount,
      pending: this.pending.size,
    };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function bytesHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += (b[i]! < 16 ? '0' : '') + b[i]!.toString(16);
  return s;
}

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Suppress unused — kept for future "verify Contact pubkey vs nodeId" hardening.
void ed25519Verify;
void compareDistance;
void xor;
void KAD_KEY_BITS;
