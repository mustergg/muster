/**
 * swarmHandler — R25 / Phase 5.
 *
 * BitSwap-lite dispatch. Owns the in-memory SwarmDB and translates
 * incoming SWARM frames (cbor-wrapped HAVE_ANNOUNCE / WANT_REQUEST /
 * WANT_RESPONSE / CANCEL) into local actions, and exposes a Promise-based
 * `wantPiece` / `wantOp` to the rest of the relay.
 *
 * Wire framing (rides peerManager's existing peer WS):
 *   { type: 'SWARM', payload: { cbor: base64(canonicalCBOR(SwarmMessage)) } }
 *
 * Phase-5 MVP simplifications (BITSWAP.md):
 *   - HAVE_ANNOUNCE.sig is 64 zero bytes; receiver does not verify it.
 *     The peer connection itself is already authenticated via the
 *     NODE_HANDSHAKE flow, so an unsigned advertisement is acceptable
 *     until we wire in node-level Ed25519 keys.
 *   - Provider selection picks the first eligible peer (no rarest-first).
 *   - Have-list bootstrapped on connect by enumerating local piece + op
 *     ids; deltas land via `announceHaveDelta`.
 *
 * Gated by MUSTER_TWO_LAYER=1 (same flag as the rest of R25).
 */

import {
  decodeCanonical,
  encodeCanonical,
  sha256,
  toHex,
  type CborValue,
} from '@muster/crypto';
import {
  swarmMessageFromCborMap,
  haveAnnounceToCborMap,
  wantRequestToCborMap,
  wantResponseToCborMap,
  cancelToCborMap,
  SWARM_MAX_HAVE_BATCH,
  SWARM_MAX_WANTS_PER_REQUEST,
  SWARM_MAX_RESPONSE_BYTES,
  SWARM_MAX_CONCURRENT_PER_PEER,
  SWARM_RESPONSE_TIMEOUT_MS,
  type WantItem,
  type WantResponseItem,
  type SwarmMessage,
} from '@muster/protocol';
import { randomBytes } from 'crypto';
import type { BlobDB } from './blobDB';
import type { OpLogDB } from './opLogDB';
import type { PeerManager } from './peerManager';
import { SwarmDB, type InFlightWant } from './swarmDB';
import type { ReputationManager } from './reputation';
import type { PosManager } from './posHandler';
import type { BandwidthMonitor } from './bandwidthMonitor';

const TIMEOUT_SWEEP_INTERVAL_MS = 1_000;
const HAVE_BROADCAST_DEBOUNCE_MS = 500;

export class SwarmManager {
  private db = new SwarmDB();
  private peerManager: PeerManager;
  private blobDB: BlobDB;
  private opLogDB: OpLogDB;

  /** 32-byte derived id (sha256 of relay nodeId string). */
  private nodeIdBytes: Uint8Array;

  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  /** Pending HAVE deltas awaiting broadcast (debounced). */
  private pendingAdds: Buffer[] = [];
  private pendingRemoves: Buffer[] = [];
  private haveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // R25 — Phase 7: Proof-of-Storage + reputation. Optional — when null
  // the swarm runs with the Phase-5 trust-everyone behaviour.
  private reputation: ReputationManager | null = null;
  private pos: PosManager | null = null;

  // R25 — Phase 9: bandwidth monitor. Optional. When wired, every outbound
  // SWARM frame is metered, every WANT round-trip feeds an RTT sample, and
  // the per-peer in-flight cap is taken from the monitor (so it can halve
  // under congestion).
  private bw: BandwidthMonitor | null = null;

  constructor(peerManager: PeerManager, blobDB: BlobDB, opLogDB: OpLogDB, nodeIdString: string) {
    this.peerManager = peerManager;
    this.blobDB = blobDB;
    this.opLogDB = opLogDB;
    this.nodeIdBytes = sha256(new TextEncoder().encode(nodeIdString));
  }

  /** R25 — Phase 7. Wire reputation + POS so wantPiece skips blacklisted
   *  peers and rewards/punishes honest/dishonest serves. */
  setReputation(reputation: ReputationManager, pos: PosManager): void {
    this.reputation = reputation;
    this.pos = pos;
  }

  /** R25 — Phase 9. Wire the bandwidth monitor for metering + adaptive cap. */
  setBandwidthMonitor(bw: BandwidthMonitor): void {
    this.bw = bw;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  start(): void {
    this.peerManager.setSwarmHooks({
      onConnect: (peerId) => this.handlePeerConnect(peerId),
      onDisconnect: (peerId) => this.handlePeerDisconnect(peerId),
      onMessage: (peerId, msg) => this.handlePeerMessage(peerId, msg),
    });
    this.sweepTimer = setInterval(() => {
      const n = this.db.sweepTimeouts(Date.now());
      if (n > 0 && process.env.MUSTER_TWO_LAYER_DEBUG) {
        console.log(`[swarm] swept ${n} expired wants`);
      }
    }, TIMEOUT_SWEEP_INTERVAL_MS);
    console.log('[swarm] BitSwap-lite started');
  }

  stop(): void {
    if (this.sweepTimer) { clearInterval(this.sweepTimer); this.sweepTimer = null; }
    if (this.haveDebounceTimer) { clearTimeout(this.haveDebounceTimer); this.haveDebounceTimer = null; }
  }

  stats(): { peerCount: number; totalHaveEntries: number; totalInFlight: number } {
    return this.db.stats();
  }

  /** Phase-7 helpers: surfaced so the periodic POS sweep in index.ts can
   *  pick targets without poking SwarmDB directly. */
  providersOf(idHex: string): string[] { return this.db.providersOf(idHex); }
  listKnownPeers(): string[] { return this.db.listPeers(); }

  // ── Peer lifecycle ───────────────────────────────────────────────────────

  private handlePeerConnect(peerId: string): void {
    this.db.registerPeer(peerId);
    // Send a fresh full-HAVE in batches.
    this.sendFullHaveTo(peerId);
  }

  private handlePeerDisconnect(peerId: string): void {
    this.db.forgetPeer(peerId);
  }

  // ── Inbound dispatch ─────────────────────────────────────────────────────

  private handlePeerMessage(peerId: string, msg: any): void {
    const cborB64 = msg?.payload?.cbor;
    if (typeof cborB64 !== 'string') return;
    let parsed: SwarmMessage;
    try {
      const bytes = Buffer.from(cborB64, 'base64');
      const map = decodeCanonical(new Uint8Array(bytes)) as Record<string, unknown>;
      parsed = swarmMessageFromCborMap(map);
    } catch (err) {
      if (process.env.MUSTER_TWO_LAYER_DEBUG) {
        console.warn(`[swarm] decode failed from ${peerId.slice(0, 12)}: ${(err as Error).message}`);
      }
      return;
    }
    switch (parsed.kind) {
      case 'HAVE_ANNOUNCE':
        this.onHaveAnnounce(peerId, parsed.additions, parsed.removals);
        break;
      case 'WANT_REQUEST':
        void this.onWantRequest(peerId, parsed.nonce, parsed.wants);
        break;
      case 'WANT_RESPONSE':
        this.onWantResponse(peerId, parsed.nonce, parsed.items);
        break;
      case 'CANCEL':
        // MVP: nothing in-progress to abort — responses are built sync.
        break;
    }
  }

  private onHaveAnnounce(peerId: string, additions: Uint8Array[], removals: Uint8Array[]): void {
    const adds = additions.map((b) => toHex(b));
    const rems = removals.map((b) => toHex(b));
    this.db.applyHaveAnnounce(peerId, adds, rems);
  }

  private async onWantRequest(peerId: string, nonce: Uint8Array, wants: WantItem[]): Promise<void> {
    if (wants.length === 0 || wants.length > SWARM_MAX_WANTS_PER_REQUEST) return;

    const items: WantResponseItem[] = [];
    let projectedBytes = 0;
    for (const w of wants) {
      if (projectedBytes >= SWARM_MAX_RESPONSE_BYTES) {
        items.push({ id: w.id, outcome: 'tooBig' });
        continue;
      }
      const it = await this.serveWant(w);
      if (it.bytes && it.bytes.length + projectedBytes > SWARM_MAX_RESPONSE_BYTES) {
        items.push({ id: w.id, outcome: 'tooBig' });
        continue;
      }
      if (it.bytes) projectedBytes += it.bytes.length;
      items.push(it);
    }

    if (!this.db.canServe(peerId, projectedBytes)) {
      // Replace with rateLimited blanket response.
      const limited: WantResponseItem[] = wants.map((w) => ({ id: w.id, outcome: 'rateLimited' }));
      this.sendSwarmTo(peerId, { kind: 'WANT_RESPONSE', nonce, items: limited });
      return;
    }
    this.db.recordServed(peerId, projectedBytes);
    this.sendSwarmTo(peerId, { kind: 'WANT_RESPONSE', nonce, items });
  }

  private async serveWant(w: WantItem): Promise<WantResponseItem> {
    if (w.kind === 'piece' || w.kind === 'chunk') {
      const piece = this.blobDB.getPiece(Buffer.from(w.id));
      if (!piece) return { id: w.id, outcome: 'notHave' };
      if (w.maxBytes !== undefined && piece.bytes.length > w.maxBytes) {
        return { id: w.id, outcome: 'tooBig' };
      }
      const out: WantResponseItem = {
        id: w.id,
        outcome: 'bytes',
        bytes: new Uint8Array(piece.bytes),
      };
      // Merkle proof generation deferred — Phase-5 MVP receivers verify
      // by recomputing sha256(bytes) against the requested id. Per-piece
      // path against a blob root is reachable through the legacy
      // PIECE_REQUEST handler (envelopeHandler.ts) when a proof is
      // required.
      return out;
    }
    if (w.kind === 'op') {
      const op = this.opLogDB.get(Buffer.from(w.id));
      if (!op) return { id: w.id, outcome: 'notHave' };
      // Op signed CBOR is reconstructed from its fields. For MVP we
      // return the stored argsCBOR concatenated with the trailer the
      // receiver already knows the schema of — but simpler: hand back
      // the canonical representation we have.
      // The relay doesn't keep the full canonical CBOR — only the row.
      // Re-encoding here would require duplicating opMessage codec.
      // Mark as notHave for MVP; pieces are the priority Phase-5 path.
      return { id: w.id, outcome: 'notHave' };
    }
    if (w.kind === 'blob') {
      // Blob-level retrieval not used in Phase 5 (clients pull per piece).
      return { id: w.id, outcome: 'notHave' };
    }
    return { id: w.id, outcome: 'notHave' };
  }

  private onWantResponse(peerId: string, nonce: Uint8Array, items: WantResponseItem[]): void {
    const inFlight = this.db.popInFlight(peerId, toHex(nonce));
    if (!inFlight) return; // Stale or already resolved.
    let bytesIn = 0;
    for (const it of items) if (it.bytes) bytesIn += it.bytes.length;
    this.db.recordReceived(peerId, bytesIn);
    // R25 — Phase 9. RTT sample = response arrival - request issue.
    if (this.bw) this.bw.recordRttSample(Date.now() - inFlight.startedAt);
    try { inFlight.resolve(items); } catch { /* ignore */ }
  }

  // ── Outbound API ─────────────────────────────────────────────────────────

  /** Issue a WANT for a single piece. Picks any peer that announced HAVE
   *  (filtering blacklisted ones when reputation is wired). On success,
   *  recomputes sha256(bytes) and rewards/punishes the provider. */
  async wantPiece(pieceIdHex: string, opts: { withProof?: boolean } = {}): Promise<Uint8Array | null> {
    const peerId = this.pickProviderRespectingReputation(pieceIdHex);
    if (!peerId) return null;
    const want: WantItem = {
      id: hexToBytes(pieceIdHex),
      kind: 'piece',
      withProof: opts.withProof === true,
    };
    const items = await this.issueWant(peerId, [want]);
    if (!items || items.length === 0) return null;
    const first = items[0];
    if (!first || first.outcome !== 'bytes' || !first.bytes) return null;

    // R25 — Phase 7. Verify the bytes hash to the requested piece id. A
    // mismatch is a malformed WANT_RESPONSE (POS.md event table -1).
    const got = sha256(first.bytes);
    if (toHex(got) !== pieceIdHex) {
      this.reputation?.applyEvent(peerId, 'WANT_HASH_MISMATCH');
      return null;
    }
    this.reputation?.addServedMB(peerId, first.bytes.length / (1024 * 1024));
    return first.bytes;
  }

  /** Phase-7 wrapper around SwarmDB.pickProvider that filters blacklisted
   *  peers when a ReputationManager is wired. Falls back to the raw
   *  Phase-5 picker when reputation is absent. */
  private pickProviderRespectingReputation(idHex: string): string | null {
    if (!this.reputation) return this.db.pickProvider(idHex);
    const candidates = this.db.providersOf(idHex);
    if (candidates.length === 0) return null;
    let preferred: string | null = null;
    let normal: string | null = null;
    let depri: string | null = null;
    for (const p of candidates) {
      if (this.reputation.isBlacklisted(p)) continue;
      const ifCap = this.bw ? this.bw.getInFlightCap() : SWARM_MAX_CONCURRENT_PER_PEER;
      if (this.db.inFlightCount(p) >= ifCap) continue;
      if (this.reputation.isPreferred(p)) { preferred = p; break; }
      if (this.reputation.isDeprioritised(p)) { depri ??= p; }
      else { normal ??= p; }
    }
    return preferred ?? normal ?? depri;
  }

  /** Broadcast a HAVE delta to all connected peers (debounced). */
  announceHaveDelta(additions: Buffer[], removals: Buffer[]): void {
    if (additions.length) this.pendingAdds.push(...additions);
    if (removals.length) this.pendingRemoves.push(...removals);
    if (this.haveDebounceTimer) return;
    this.haveDebounceTimer = setTimeout(() => {
      this.flushPendingHave();
    }, HAVE_BROADCAST_DEBOUNCE_MS);
  }

  private flushPendingHave(): void {
    this.haveDebounceTimer = null;
    // R25 — Phase 9. If we're already over the per-second cap, defer the
    // HAVE flush by another debounce window. HAVE deltas are not
    // latency-critical — a few extra hundred ms is fine.
    if (this.bw?.isOverCap()) {
      this.haveDebounceTimer = setTimeout(() => this.flushPendingHave(), HAVE_BROADCAST_DEBOUNCE_MS);
      return;
    }
    const adds = this.pendingAdds;
    const rems = this.pendingRemoves;
    this.pendingAdds = [];
    this.pendingRemoves = [];
    if (adds.length === 0 && rems.length === 0) return;

    const peers = this.peerManager.getConnectedPeerIds();
    if (peers.length === 0) return;

    // Chunk so each announce fits SWARM_MAX_HAVE_BATCH.
    const total = Math.max(adds.length, rems.length);
    for (let i = 0; i < total; i += SWARM_MAX_HAVE_BATCH) {
      const sliceAdds = adds.slice(i, i + SWARM_MAX_HAVE_BATCH).map((b) => new Uint8Array(b));
      const sliceRems = rems.slice(i, i + SWARM_MAX_HAVE_BATCH).map((b) => new Uint8Array(b));
      const ann = this.buildHaveAnnounce(sliceAdds, sliceRems);
      for (const peerId of peers) this.sendSwarmTo(peerId, ann);
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async issueWant(peerId: string, wants: WantItem[]): Promise<WantResponseItem[] | null> {
    const nonce = randomBytes(16);
    const nonceHex = nonce.toString('hex');
    return new Promise<WantResponseItem[] | null>((resolve) => {
      const inFlight: InFlightWant = {
        nonce: nonceHex,
        peerId,
        items: wants,
        startedAt: Date.now(),
        deadline: Date.now() + SWARM_RESPONSE_TIMEOUT_MS,
        resolve: (items) => resolve(items),
        reject: () => resolve(null),
      };
      const ok = this.db.addInFlight(inFlight);
      if (!ok) { resolve(null); return; }
      this.sendSwarmTo(peerId, {
        kind: 'WANT_REQUEST',
        nonce: new Uint8Array(nonce),
        wants,
      });
    });
  }

  private sendFullHaveTo(peerId: string): void {
    const pieceIds = this.blobDB.allPieceIds();
    const opIds = this.opLogDB.allOpIds();
    const all = [...pieceIds, ...opIds];
    if (all.length === 0) {
      // Still send an empty announce so the peer learns we're a candidate.
      this.sendSwarmTo(peerId, this.buildHaveAnnounce([], []));
      return;
    }
    for (let i = 0; i < all.length; i += SWARM_MAX_HAVE_BATCH) {
      const batch = all.slice(i, i + SWARM_MAX_HAVE_BATCH).map((b) => new Uint8Array(b));
      this.sendSwarmTo(peerId, this.buildHaveAnnounce(batch, []));
    }
  }

  private buildHaveAnnounce(adds: Uint8Array[], rems: Uint8Array[]): SwarmMessage {
    return {
      kind: 'HAVE_ANNOUNCE',
      nodeId: this.nodeIdBytes,
      additions: adds,
      removals: rems,
      ts: Date.now(),
      // MVP: unsigned. Receiver does not verify in Phase 5.
      sig: new Uint8Array(64),
    };
  }

  private sendSwarmTo(peerId: string, msg: SwarmMessage): boolean {
    const map = swarmMessageToCborMap(msg);
    const bytes = encodeCanonical(map as CborValue);
    const cbor = Buffer.from(bytes).toString('base64');
    const sent = this.peerManager.sendToPeer(peerId, {
      type: 'SWARM',
      payload: { cbor },
      timestamp: Date.now(),
    });
    // R25 — Phase 9. Meter outbound (raw frame size; wrapper JSON overhead
    // is negligible compared to the cbor blob).
    if (sent && this.bw) this.bw.recordOutBytes(bytes.length);
    return sent;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function swarmMessageToCborMap(msg: SwarmMessage): Record<string, unknown> {
  switch (msg.kind) {
    case 'HAVE_ANNOUNCE': return haveAnnounceToCborMap(msg);
    case 'WANT_REQUEST': return wantRequestToCborMap(msg);
    case 'WANT_RESPONSE': return wantResponseToCborMap(msg);
    case 'CANCEL': return cancelToCborMap(msg);
  }
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

