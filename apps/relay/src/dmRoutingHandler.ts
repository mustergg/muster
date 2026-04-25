/**
 * DmRoutingHandler — R25 / Phase 8.
 *
 * Sealed-sender DM routing. Bridges three flows:
 *
 *   1. Browser client → relay subscribe / unsubscribe to one or more
 *      32-byte inbox hashes (their own current/prev/next windows).
 *      Wire: { type:'DM_SUBSCRIBE', payload:{ inboxHashes:[hex,...] } }
 *            { type:'DM_UNSUBSCRIBE', payload:{ inboxHashes:[hex,...] } }
 *
 *   2. Browser client (sender) → relay publish a DM_FRAME for an
 *      inbox hash. Relay
 *        a) delivers locally to any subscribed clients (looks up
 *           inbox hash in subscriptions, sends DM_DELIVER to clients);
 *        b) consults DHT INBOX_ROUTE for that hash → forwards the
 *           frame as DM_FRAME to those relays;
 *        c) if no route, holds the frame in orphan_dm with TTL 24h
 *           and retries every 15 min (advertised window may rotate
 *           in by then).
 *      Wire (browser → relay): same DM_FRAME envelope.
 *
 *   3. Peer relay → relay DM_FRAME forward. Identical handling — drop
 *      to local subscribers if any, otherwise hold as orphan.
 *
 * Privacy model: the relay never sees plaintext recipient pubkeys —
 * only inbox hashes. The sender pubkey is sealed inside the encrypted
 * payload (recovered by the recipient via ECDH). See docs/specs/DM.md.
 */

import { encodeCanonical, decodeCanonical, sha256, toHex, fromHex, type CborValue } from '@muster/crypto';
import {
  DM_INBOX_BYTES,
  DM_MAX_CIPHERTEXT_BYTES,
  DM_RATE_FRAMES_PER_MINUTE,
  DM_ORPHAN_RETRY_INTERVAL_MS,
  dmFrameToCborMap,
  dmFrameFromCborMap,
  type DmFrame,
} from '@muster/protocol';
import { deriveContentKey, KAD_TTL_MS } from '@muster/dht';
import type { PeerManager } from './peerManager';
import type { DmRoutingDB } from './dmRoutingDB';
import type { DhtManager } from './dhtHandler';
import type { ReputationManager } from './reputation';

/** How long a single DM_SUBSCRIBE keeps an inbox hash alive on the relay.
 *  Browser refreshes on every reconnect; 12h covers two windows. */
const SUB_TTL_MS = 12 * 60 * 60 * 1000;

/** Max plausible inbox hashes from a single SUBSCRIBE call. Bounds the
 *  number of subscriptions a single client can register at once. */
const MAX_INBOX_HASHES_PER_SUBSCRIBE = 16;

interface DmRateBucket {
  /** Rolling 60-second window: ms timestamps of frames seen. */
  ts: number[];
}

/** Minimal view of a connected browser client for delivery. */
export interface DmRoutingClient {
  ws: { readyState: number; send: (data: string) => void };
  /** Local stable id used as `subscriberId`. */
  clientKey: string;
}

const WS_OPEN = 1;

export class DmRoutingHandler {
  private peerManager: PeerManager;
  private db: DmRoutingDB;
  private dht: DhtManager | null;
  private reputation: ReputationManager | null;

  /** Per-inbox-hash rate bucket — drops excess frames. */
  private rate = new Map<string, DmRateBucket>();
  /** clientKey → ws handle. Populated as clients SUBSCRIBE. */
  private clients = new Map<string, DmRoutingClient>();

  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private subPruneTimer: ReturnType<typeof setInterval> | null = null;
  private advertiseTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    peerManager: PeerManager,
    db: DmRoutingDB,
    dht: DhtManager | null,
    reputation: ReputationManager | null,
  ) {
    this.peerManager = peerManager;
    this.db = db;
    this.dht = dht;
    this.reputation = reputation;
  }

  start(): void {
    // Periodic orphan retry — every 15 min per spec.
    this.retryTimer = setInterval(() => {
      this.retryOrphans().catch((err) => {
        if (process.env.MUSTER_TWO_LAYER_DEBUG) {
          console.warn('[dm-route] retry sweep error:', (err as Error).message);
        }
      });
    }, DM_ORPHAN_RETRY_INTERVAL_MS);

    // Hourly cleanup of expired subs + 24h+ orphans.
    this.subPruneTimer = setInterval(() => {
      const subs = this.db.pruneExpiredSubscriptions();
      const orph = this.db.pruneExpiredOrphans();
      if (subs > 0 || orph > 0) {
        console.log(`[dm-route] prune: ${subs} subs, ${orph} orphans (>24h)`);
      }
    }, 60 * 60 * 1000);

    // Advertise our locally-subscribed inbox hashes into the DHT every
    // 30 min (well under KAD_TTL_MS = 1h to avoid expiry gaps).
    this.advertiseTimer = setInterval(() => {
      this.advertiseLocalSubscriptions().catch((err) => {
        if (process.env.MUSTER_TWO_LAYER_DEBUG) {
          console.warn('[dm-route] advertise error:', (err as Error).message);
        }
      });
    }, 30 * 60 * 1000);

    console.log('[dm-route] sealed-sender DM routing started');
  }

  stop(): void {
    if (this.retryTimer) clearInterval(this.retryTimer);
    if (this.subPruneTimer) clearInterval(this.subPruneTimer);
    if (this.advertiseTimer) clearInterval(this.advertiseTimer);
    this.retryTimer = this.subPruneTimer = this.advertiseTimer = null;
  }

  // ── Browser-client API ───────────────────────────────────────────────────

  /**
   * Returns true if the message was a DM-routing message (handled).
   * Otherwise returns false so the caller can keep dispatching.
   */
  handleClientMessage(client: DmRoutingClient, msg: { type: string; payload?: unknown }): boolean {
    if (msg.type === 'DM_SUBSCRIBE') return this.onSubscribe(client, msg.payload);
    if (msg.type === 'DM_UNSUBSCRIBE') return this.onUnsubscribe(client, msg.payload);
    if (msg.type === 'DM_FRAME') {
      void this.onIncomingFrame('client', client.clientKey, msg.payload);
      return true;
    }
    return false;
  }

  /** Called when a browser client disconnects — drop its subscriptions. */
  forgetClient(clientKey: string): void {
    this.clients.delete(clientKey);
    const removed = this.db.removeSubscriberAll(clientKey);
    if (removed > 0 && process.env.MUSTER_TWO_LAYER_DEBUG) {
      console.log(`[dm-route] dropped ${removed} subs for ${clientKey.slice(0, 12)}`);
    }
  }

  // ── Peer-to-peer API ─────────────────────────────────────────────────────

  /** Wired into peerManager's DM hook (see index.ts).
   *  Returns true when the message was DM_FRAME (consumed). */
  handlePeerMessage(peerId: string, msg: { type: string; payload?: unknown }): boolean {
    if (msg.type !== 'DM_FRAME') return false;
    void this.onIncomingFrame('peer', peerId, msg.payload);
    return true;
  }

  // ── Inbound frame handling ──────────────────────────────────────────────

  private async onIncomingFrame(
    origin: 'client' | 'peer',
    senderId: string,
    payload: unknown,
  ): Promise<void> {
    const frame = decodeFramePayload(payload);
    if (!frame) {
      if (process.env.MUSTER_TWO_LAYER_DEBUG) {
        console.warn(`[dm-route] bad DM_FRAME from ${origin}:${senderId.slice(0, 12)}`);
      }
      return;
    }
    if (frame.ciphertext.length + frame.padding.length > DM_MAX_CIPHERTEXT_BYTES) {
      // Spec hard cap; drop silently — no rep penalty (sender may be out
      // of sync with our limits).
      return;
    }

    const inboxHashHex = toHex(frame.inboxHash);
    if (!this.consumeRate(inboxHashHex)) {
      if (this.reputation && origin === 'peer') {
        // POS.md doesn't list a DM_RATE_LIMITED event; we use the
        // existing WANT_HASH_MISMATCH (-1) as a generic "misbehaved"
        // tap. Real flooding will trip the blacklist via accumulation.
        this.reputation.applyEvent(senderId, 'WANT_HASH_MISMATCH');
      }
      return;
    }

    const cborBytes = encodeCanonical(dmFrameToCborMap(frame) as CborValue);
    const dmId = toHex(sha256(cborBytes));

    // 1. Local delivery — every browser client that subscribed to this hash.
    const subs = this.db.subscribersFor(inboxHashHex);
    let localDelivered = 0;
    let remoteForwarded = 0;
    const knownPeers = new Set<string>();
    for (const s of subs) {
      if (s.local) {
        const c = this.clients.get(s.subscriberId);
        if (c && c.ws.readyState === WS_OPEN) {
          c.ws.send(JSON.stringify({
            type: 'DM_DELIVER',
            payload: { frame: encodeFramePayload(frame), dmId },
            timestamp: Date.now(),
          }));
          localDelivered += 1;
        }
      } else {
        knownPeers.add(s.subscriberId);
      }
    }

    // 2. Forward to remote peers we already know subscribe (from prior
    //    DM_SUBSCRIBE peer-to-peer registrations) — best-effort.
    for (const peerId of knownPeers) {
      if (origin === 'peer' && peerId === senderId) continue; // Don't echo back
      if (this.peerManager.sendToPeer(peerId, {
        type: 'DM_FRAME',
        payload: { cbor: encodeFramePayload(frame) },
        timestamp: Date.now(),
      })) {
        remoteForwarded += 1;
      }
    }

    // 3. If origin is a local client (we're an entry-point relay), look
    //    up DHT INBOX_ROUTE → forward to those relays. Skip when origin
    //    is already a peer (avoid amplification loops — the spec already
    //    advertises only entry-point relays as routes).
    if (origin === 'client' && this.dht) {
      try {
        const key = deriveContentKey('inbox', frame.inboxHash);
        const records = await this.dht.findRecords(key);
        const seenWsUrls = new Set<string>();
        const myUrl = this.peerManager.getOwnUrl?.();
        if (myUrl) seenWsUrls.add(myUrl);
        for (const r of records) {
          if (seenWsUrls.has(r.wsUrl)) continue;
          seenWsUrls.add(r.wsUrl);
          const peerId = this.peerManager.findPeerByUrl?.(r.wsUrl);
          if (!peerId) continue;
          if (knownPeers.has(peerId)) continue;
          if (this.peerManager.sendToPeer(peerId, {
            type: 'DM_FRAME',
            payload: { cbor: encodeFramePayload(frame) },
            timestamp: Date.now(),
          })) {
            remoteForwarded += 1;
          }
        }
      } catch (err) {
        if (process.env.MUSTER_TWO_LAYER_DEBUG) {
          console.warn('[dm-route] DHT lookup failed:', (err as Error).message);
        }
      }
    }

    // 4. No route at all → orphan it, retried every 15 min.
    if (localDelivered === 0 && remoteForwarded === 0) {
      this.db.insertOrphan({
        dmId,
        inboxHashHex,
        frameCBOR: Buffer.from(cborBytes),
        ts: Date.now(),
      });
    }

    if (process.env.MUSTER_TWO_LAYER_DEBUG) {
      console.log(`[dm-route] frame ${dmId.slice(0, 8)} via ${origin}: local=${localDelivered} fwd=${remoteForwarded}`);
    }
  }

  // ── Subscribe / Unsubscribe ──────────────────────────────────────────────

  private onSubscribe(client: DmRoutingClient, payload: unknown): boolean {
    const hashes = parseInboxHashList(payload);
    if (!hashes) return true; // Bad payload — silently drop, but consumed.
    this.clients.set(client.clientKey, client);
    const expiresAt = Date.now() + SUB_TTL_MS;
    let added = 0;
    for (const h of hashes) {
      this.db.upsertSubscription({
        inboxHashHex: h,
        subscriberId: client.clientKey,
        local: true,
        expiresAt,
      });
      added += 1;
      // Drain orphans for this hash now that someone's listening.
      this.drainOrphansFor(h, client);
    }
    // Fire-and-forget DHT advertisement for fresh hashes.
    if (this.dht) {
      void this.advertiseHashes(hashes).catch(() => { /* swallow */ });
    }
    if (process.env.MUSTER_TWO_LAYER_DEBUG) {
      console.log(`[dm-route] client ${client.clientKey.slice(0, 12)} subscribed to ${added} inbox hashes`);
    }
    return true;
  }

  private onUnsubscribe(client: DmRoutingClient, payload: unknown): boolean {
    const hashes = parseInboxHashList(payload);
    if (!hashes) return true;
    for (const h of hashes) this.db.removeSubscription(h, client.clientKey);
    return true;
  }

  private drainOrphansFor(inboxHashHex: string, client: DmRoutingClient): void {
    const orphans = this.db.orphansFor(inboxHashHex);
    if (orphans.length === 0) return;
    for (const o of orphans) {
      try {
        const map = decodeCanonical(new Uint8Array(o.frameCBOR)) as Record<string, unknown>;
        const frame = dmFrameFromCborMap(map);
        client.ws.send(JSON.stringify({
          type: 'DM_DELIVER',
          payload: { frame: encodeFramePayload(frame), dmId: o.dmId },
          timestamp: Date.now(),
        }));
        this.db.deleteOrphan(o.dmId);
      } catch {
        // Bad orphan row — drop it to avoid hot-looping.
        this.db.deleteOrphan(o.dmId);
      }
    }
    console.log(`[dm-route] drained ${orphans.length} orphan(s) for ${inboxHashHex.slice(0, 12)}…`);
  }

  // ── DHT advertisement ───────────────────────────────────────────────────

  private async advertiseLocalSubscriptions(): Promise<void> {
    if (!this.dht) return;
    const hashes = this.db.locallySubscribedInboxHashes();
    if (hashes.length === 0) return;
    await this.advertiseHashes(hashes);
  }

  private async advertiseHashes(inboxHashHexList: string[]): Promise<void> {
    if (!this.dht) return;
    let advertised = 0;
    for (const hex of inboxHashHexList) {
      const inboxHash = fromHex(hex);
      const key = deriveContentKey('inbox', inboxHash);
      try {
        await this.dht.advertise({ key, kind: 'INBOX_ROUTE', ttlMs: KAD_TTL_MS });
        advertised += 1;
      } catch (err) {
        if (process.env.MUSTER_TWO_LAYER_DEBUG) {
          console.warn('[dm-route] advertise failed:', (err as Error).message);
        }
      }
    }
    if (process.env.MUSTER_TWO_LAYER_DEBUG && advertised > 0) {
      console.log(`[dm-route] advertised ${advertised} inbox routes into DHT`);
    }
  }

  // ── Orphan retry ─────────────────────────────────────────────────────────

  private async retryOrphans(): Promise<void> {
    const due = this.db.orphansToRetry(Date.now(), DM_ORPHAN_RETRY_INTERVAL_MS);
    if (due.length === 0) return;
    let delivered = 0;
    for (const o of due) {
      this.db.markOrphanRetried(o.dmId);
      try {
        const map = decodeCanonical(new Uint8Array(o.frameCBOR)) as Record<string, unknown>;
        const frame = dmFrameFromCborMap(map);
        // Replay through the normal handler (origin: 'peer' so we skip the
        // DHT echo path — the relay holding the orphan IS the entry-point
        // and won't otherwise consult DHT for re-routing).
        await this.onIncomingFrame('peer', '__orphan_retry__', { cbor: encodeFramePayload(frame) });
        delivered += 1;
      } catch {
        this.db.deleteOrphan(o.dmId);
      }
    }
    if (delivered > 0) {
      console.log(`[dm-route] orphan retry: ${delivered} re-attempted`);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private consumeRate(inboxHashHex: string, now = Date.now()): boolean {
    let bucket = this.rate.get(inboxHashHex);
    if (!bucket) {
      bucket = { ts: [] };
      this.rate.set(inboxHashHex, bucket);
    }
    while (bucket.ts.length > 0 && (bucket.ts[0] ?? 0) < now - 60_000) bucket.ts.shift();
    if (bucket.ts.length >= DM_RATE_FRAMES_PER_MINUTE) return false;
    bucket.ts.push(now);
    return true;
  }

  stats() {
    return { ...this.db.stats(), rateBuckets: this.rate.size, clients: this.clients.size };
  }
}

// ─── Wire helpers ──────────────────────────────────────────────────────────

function decodeFramePayload(payload: unknown): DmFrame | null {
  if (!payload || typeof payload !== 'object') return null;
  const cborB64 = (payload as { cbor?: unknown }).cbor;
  if (typeof cborB64 !== 'string') return null;
  try {
    const bytes = new Uint8Array(Buffer.from(cborB64, 'base64'));
    const map = decodeCanonical(bytes) as Record<string, unknown>;
    const frame = dmFrameFromCborMap(map);
    if (frame.inboxHash.length !== DM_INBOX_BYTES) return null;
    return frame;
  } catch {
    return null;
  }
}

function encodeFramePayload(frame: DmFrame): string {
  const bytes = encodeCanonical(dmFrameToCborMap(frame) as CborValue);
  return Buffer.from(bytes).toString('base64');
}

function parseInboxHashList(payload: unknown): string[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = (payload as { inboxHashes?: unknown }).inboxHashes;
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0 || raw.length > MAX_INBOX_HASHES_PER_SUBSCRIBE) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return null;
    if (item.length !== DM_INBOX_BYTES * 2) return null;
    if (!/^[0-9a-fA-F]+$/.test(item)) return null;
    out.push(item.toLowerCase());
  }
  return out;
}
