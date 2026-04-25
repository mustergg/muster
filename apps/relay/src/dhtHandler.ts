/**
 * DHT Manager — R25 / Phase 6
 *
 * Bridges peerManager (string nodeIds, JSON over WS) and DhtNode
 * (32-byte node ids, canonical-CBOR DHT messages). Owns a single
 * DhtNode instance; transports DHT frames as
 *   { type:'DHT', payload:{ cbor:'<base64>' } }
 * over the existing peer connections.
 *
 * Periodic responsibilities:
 *   - bucket refresh (1 h) — re-issue FIND_NODE on any bucket whose
 *     last refresh is older than KAD_BUCKET_REFRESH_MS
 *   - replicate (1 h) — re-STORE every record we hold on the k closest
 *     live nodes to its key (covers churn)
 *   - GC (5 min) — drop expired records from the value store
 */

import { encodeCanonical, decodeCanonical, fromHex } from '@muster/crypto';
import {
  DhtNode,
  type DhtTransport,
  type Contact,
  type DhtMessage,
  type DhtRecord,
  KAD_BUCKET_REFRESH_MS,
  KAD_REPLICATE_MS,
  KAD_K,
  dhtMessageToCborMap,
  dhtMessageFromCborMap,
  deriveNodeIds,
} from '@muster/dht';
import type { PeerManager } from './peerManager';

/** GC interval for expired records. */
const DHT_GC_INTERVAL_MS = 5 * 60 * 1000;

/** Bucket-refresh sweep interval. */
const DHT_BUCKET_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export class DhtManager {
  private peerManager: PeerManager;
  private node: DhtNode;

  /** hex(nodeId32) → peerStringId in peerManager. */
  private nodeIdToPeer = new Map<string, string>();
  /** peerStringId → hex(nodeId32). Reverse map for cleanup. */
  private peerToNodeId = new Map<string, string>();

  private gcTimer: ReturnType<typeof setInterval> | null = null;
  private bucketTimer: ReturnType<typeof setInterval> | null = null;
  private replicateTimer: ReturnType<typeof setInterval> | null = null;

  constructor(peerManager: PeerManager, identity: { pubkeyHex: string; privkeyHex: string; wsUrl: string }) {
    this.peerManager = peerManager;
    const pubkey = fromHex(identity.pubkeyHex);
    const privkey = fromHex(identity.privkeyHex);
    const transport: DhtTransport = {
      send: (toNodeId, msg) => this.sendOverPeer(toNodeId, msg),
    };
    this.node = new DhtNode({ pubkey, privkey, wsUrl: identity.wsUrl }, transport);
  }

  /** Public for index.ts boot logging + DHT_QUERY routing. */
  getNode(): DhtNode { return this.node; }

  start(): void {
    this.peerManager.setDhtHooks({
      onConnect: (peerId, dhtPubkeyHex, dhtUrl) => this.onPeerConnect(peerId, dhtPubkeyHex, dhtUrl),
      onDisconnect: (peerId) => this.onPeerDisconnect(peerId),
      onMessage: (peerId, msg) => this.onPeerMessage(peerId, msg),
    });

    // Pre-existing peers (started before us) — bootstrap from snapshot.
    const seeds: Contact[] = [];
    for (const p of this.peerManager.getDhtPeers()) {
      const c = this.peerToContact(p.peerId, p.dhtPubkeyHex, p.dhtUrl);
      if (c) seeds.push(c);
    }
    if (seeds.length > 0) {
      this.node.bootstrap(seeds).catch((err) => {
        console.warn('[dht] bootstrap error:', (err as Error).message);
      });
      console.log(`[dht] bootstrap: seeded ${seeds.length} contacts`);
    }

    this.gcTimer = setInterval(() => {
      const dropped = this.node.store.gcExpired();
      if (dropped > 0) console.log(`[dht] gc: dropped ${dropped} expired records`);
    }, DHT_GC_INTERVAL_MS);

    this.bucketTimer = setInterval(() => this.refreshStaleBuckets().catch(() => { /* swallow */ }), DHT_BUCKET_REFRESH_INTERVAL_MS);

    this.replicateTimer = setInterval(() => this.replicateRecords().catch(() => { /* swallow */ }), KAD_REPLICATE_MS);

    console.log(`[dht] manager started (nodeId=${shortHex(this.node.nodeId)} contacts=${this.node.table.size()})`);
  }

  stop(): void {
    if (this.gcTimer) clearInterval(this.gcTimer);
    if (this.bucketTimer) clearInterval(this.bucketTimer);
    if (this.replicateTimer) clearInterval(this.replicateTimer);
    this.gcTimer = this.bucketTimer = this.replicateTimer = null;
  }

  // ── peerManager hook handlers ────────────────────────────────────────────

  private onPeerConnect(peerId: string, dhtPubkeyHex: string, dhtUrl: string): void {
    const c = this.peerToContact(peerId, dhtPubkeyHex, dhtUrl);
    if (!c) return;
    const idHex = bytesHex(c.nodeId);
    this.nodeIdToPeer.set(idHex, peerId);
    this.peerToNodeId.set(peerId, idHex);
    this.node.table.add(c);
  }

  private onPeerDisconnect(peerId: string): void {
    const idHex = this.peerToNodeId.get(peerId);
    if (!idHex) return;
    this.nodeIdToPeer.delete(idHex);
    this.peerToNodeId.delete(peerId);
    // Routing table will naturally evict on next add. Leave entry —
    // a stale-but-not-removed contact will fail RPC and get pushed out.
  }

  private onPeerMessage(peerId: string, frame: { type: string; payload?: { cbor?: string } }): void {
    const cborB64 = frame.payload?.cbor;
    if (typeof cborB64 !== 'string') return;
    let msg: DhtMessage;
    try {
      const bytes = base64Decode(cborB64);
      msg = dhtMessageFromCborMap(decodeCanonical(bytes) as Record<string, unknown>);
    } catch (err) {
      console.warn('[dht] bad inbound DHT frame from', peerId, ':', (err as Error).message);
      return;
    }

    // Build the sender Contact from what we already know about this peer.
    const idHex = this.peerToNodeId.get(peerId);
    let from: Contact | null = null;
    if (idHex) {
      from = this.contactFromTable(idHex) ?? null;
    }
    if (!from) {
      // Peer connected before we learned its DHT identity — try snapshot.
      const snap = this.peerManager.getDhtPeers().find((p) => p.peerId === peerId);
      if (snap) from = this.peerToContact(peerId, snap.dhtPubkeyHex, snap.dhtUrl);
    }
    if (!from) {
      // Drop — can't auth a sender we don't know.
      return;
    }
    this.node.handleMessage(from, msg).catch((err) => {
      console.warn('[dht] handleMessage error:', (err as Error).message);
    });
  }

  // ── DhtTransport.send ────────────────────────────────────────────────────

  private sendOverPeer(toNodeId: Uint8Array, msg: DhtMessage): boolean {
    const idHex = bytesHex(toNodeId);
    const peerId = this.nodeIdToPeer.get(idHex);
    if (!peerId) return false;
    let cborB64: string;
    try {
      const bytes = encodeCanonical(dhtMessageToCborMap(msg) as never);
      cborB64 = base64Encode(bytes);
    } catch (err) {
      console.warn('[dht] encode error:', (err as Error).message);
      return false;
    }
    return this.peerManager.sendToPeer(peerId, {
      type: 'DHT',
      payload: { cbor: cborB64 },
      timestamp: Date.now(),
    });
  }

  // ── Periodic maintenance ─────────────────────────────────────────────────

  private async refreshStaleBuckets(): Promise<void> {
    const stale = this.node.table.staleBuckets(KAD_BUCKET_REFRESH_MS);
    if (stale.length === 0) return;
    for (const idx of stale) {
      // Pick a random target inside the bucket (XOR of self with a 1-bit at idx).
      const target = new Uint8Array(this.node.nodeId160);
      const byte = idx >> 3;
      const bit = 7 - (idx & 7);
      if (byte < target.length) target[byte] = (target[byte] ?? 0) ^ (1 << bit);
      await this.node.iterativeFindNode(target).catch(() => { /* swallow */ });
    }
  }

  private async replicateRecords(): Promise<void> {
    const records = this.node.store.allRecords();
    if (records.length === 0) return;
    let replicated = 0;
    for (const rec of records) {
      const closest = await this.node.iterativeFindNode(rec.key).catch(() => [] as Contact[]);
      const targets = closest.slice(0, KAD_K);
      const acks = await Promise.all(targets.map((c) => this.node.storeOnce(c, rec.key, rec).catch(() => false)));
      replicated += acks.filter(Boolean).length;
    }
    if (replicated > 0) console.log(`[dht] replicate: ${records.length} records, ${replicated} acks`);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private peerToContact(peerId: string, pubkeyHex: string, wsUrl: string): Contact | null {
    try {
      const pubkey = fromHex(pubkeyHex);
      const ids = deriveNodeIds(pubkey);
      // Reverse-map maintenance happens in onConnect; do it here too in case
      // we're called during bootstrap before any onConnect has fired.
      const idHex = bytesHex(ids.nodeId);
      this.nodeIdToPeer.set(idHex, peerId);
      this.peerToNodeId.set(peerId, idHex);
      return {
        nodeId: ids.nodeId,
        nodeId160: ids.nodeId160,
        pubkey,
        wsUrl,
        lastSeen: Date.now(),
      };
    } catch {
      return null;
    }
  }

  private contactFromTable(idHex: string): Contact | undefined {
    const all = this.node.table.allContacts();
    for (const c of all) if (bytesHex(c.nodeId) === idHex) return c;
    return undefined;
  }

  // ── Public API for browser bridge ────────────────────────────────────────

  /** Iterative FIND_VALUE wrapper used by the DHT_QUERY handler. */
  async findRecords(key: Uint8Array): Promise<DhtRecord[]> {
    return this.node.iterativeFindValue(key);
  }

  /** Advertise our own provider record for a content key. */
  async advertise(args: { key: Uint8Array; kind: DhtRecord['kind']; ttlMs?: number }): Promise<number> {
    return this.node.advertise(args);
  }

  stats(): { contacts: number; storedRecords: number; pending: number } {
    return this.node.stats();
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function bytesHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += (b[i]! < 16 ? '0' : '') + b[i]!.toString(16);
  return s;
}

function shortHex(b: Uint8Array): string { return bytesHex(b).slice(0, 16) + '...'; }

function base64Encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function base64Decode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}
