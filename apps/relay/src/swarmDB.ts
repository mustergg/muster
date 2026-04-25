/**
 * swarmDB — R25 / Phase 5.
 *
 * In-memory bookkeeping for the BitSwap-lite swarm layer. State is
 * ephemeral by design — peers re-announce their have-lists on every
 * reconnect (BITSWAP.md §Have-list management). Persisting peer
 * have-sets across restarts isn't worth the storage churn.
 *
 * Tracks:
 *   - per-peer have-set (what each peer claims to hold)
 *   - per-peer pending have-deltas (debounce buffer)
 *   - per-peer in-flight WANT nonces + their items
 *   - per-peer byte budgets (rolling 60-second window, both directions)
 *
 * Scheduler queries this DB to find providers for a given content id and
 * to enforce flow-control caps before dispatching WANT_REQUESTs.
 *
 * Gated behind MUSTER_TWO_LAYER=1 via the top-level wiring in `index.ts`.
 */

import {
  SWARM_BYTE_BUDGET_PER_MIN,
  SWARM_MAX_CONCURRENT_PER_PEER,
  type ContentKind,
  type WantItem,
} from '@muster/protocol';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * One in-flight WANT_REQUEST awaiting a WANT_RESPONSE. Identified by the
 * nonce assigned at issue time. Items are kept so the receiver knows
 * which proof to verify each response against.
 */
export interface InFlightWant {
  nonce: string;            // hex(nonce)
  peerId: string;           // recipient
  items: WantItem[];
  startedAt: number;
  /** Aggregate timeout for the whole batch. */
  deadline: number;
  /** Resolved when WANT_RESPONSE arrives or timeout fires. */
  resolve: (items: import('@muster/protocol').WantResponseItem[]) => void;
  reject: (err: Error) => void;
}

interface ByteBudget {
  /** Bytes counted in the current minute window. */
  bytes: number;
  /** Window start (ms). Reset every 60 s. */
  windowStart: number;
}

interface PeerState {
  haveSet: Set<string>;          // hex(id) → present
  inFlightOut: Map<string, InFlightWant>; // nonce → request (we sent)
  inFlightInCount: number;       // how many WANTs currently being served back
  outBudget: ByteBudget;
  inBudget: ByteBudget;
}

// ─── DB ─────────────────────────────────────────────────────────────────────

export class SwarmDB {
  private peers = new Map<string, PeerState>();

  // ── Peer lifecycle ───────────────────────────────────────────────────────

  /** Idempotent. Called when a peer connects. */
  registerPeer(peerId: string): void {
    if (this.peers.has(peerId)) return;
    this.peers.set(peerId, {
      haveSet: new Set(),
      inFlightOut: new Map(),
      inFlightInCount: 0,
      outBudget: { bytes: 0, windowStart: Date.now() },
      inBudget: { bytes: 0, windowStart: Date.now() },
    });
  }

  /** Drops all swarm state for the peer. Cancels any in-flight WANTs. */
  forgetPeer(peerId: string): void {
    const p = this.peers.get(peerId);
    if (!p) return;
    for (const w of p.inFlightOut.values()) {
      try { w.reject(new Error('swarm: peer disconnected')); } catch { /* ignore */ }
    }
    this.peers.delete(peerId);
  }

  knowsPeer(peerId: string): boolean {
    return this.peers.has(peerId);
  }

  listPeers(): string[] {
    return [...this.peers.keys()];
  }

  // ── Have-set management ─────────────────────────────────────────────────

  applyHaveAnnounce(peerId: string, additions: string[], removals: string[]): void {
    const p = this.peers.get(peerId);
    if (!p) return;
    for (const id of additions) p.haveSet.add(id);
    for (const id of removals) p.haveSet.delete(id);
  }

  peerHas(peerId: string, idHex: string): boolean {
    return this.peers.get(peerId)?.haveSet.has(idHex) ?? false;
  }

  /** Set of peer ids that announced HAVE for this content id. */
  providersOf(idHex: string): string[] {
    const out: string[] = [];
    for (const [peerId, st] of this.peers) {
      if (st.haveSet.has(idHex)) out.push(peerId);
    }
    return out;
  }

  /**
   * Pick a single provider for a content id. Phase-5 MVP: first eligible
   * peer with available concurrency slot. Rarest-first refinement comes
   * later — this still beats the bulk SYNC fallback.
   */
  pickProvider(idHex: string): string | null {
    for (const [peerId, st] of this.peers) {
      if (!st.haveSet.has(idHex)) continue;
      if (st.inFlightOut.size >= SWARM_MAX_CONCURRENT_PER_PEER) continue;
      return peerId;
    }
    return null;
  }

  // ── In-flight WANT tracking ─────────────────────────────────────────────

  addInFlight(want: InFlightWant): boolean {
    const p = this.peers.get(want.peerId);
    if (!p) return false;
    if (p.inFlightOut.size >= SWARM_MAX_CONCURRENT_PER_PEER) return false;
    p.inFlightOut.set(want.nonce, want);
    return true;
  }

  popInFlight(peerId: string, nonceHex: string): InFlightWant | null {
    const p = this.peers.get(peerId);
    if (!p) return null;
    const w = p.inFlightOut.get(nonceHex);
    if (!w) return null;
    p.inFlightOut.delete(nonceHex);
    return w;
  }

  inFlightCount(peerId: string): number {
    return this.peers.get(peerId)?.inFlightOut.size ?? 0;
  }

  /** Sweep expired in-flight WANTs and reject their promises. */
  sweepTimeouts(now: number): number {
    let n = 0;
    for (const [, st] of this.peers) {
      for (const [nonce, w] of st.inFlightOut) {
        if (now > w.deadline) {
          st.inFlightOut.delete(nonce);
          try { w.reject(new Error('swarm: WANT timeout')); } catch { /* ignore */ }
          n += 1;
        }
      }
    }
    return n;
  }

  // ── Byte budgets ────────────────────────────────────────────────────────
  //
  // Rolling 60-second windows per peer per direction. When exceeded, the
  // serving side returns `outcome: 'rateLimited'` and the client SHOULD
  // back off for 60 s (BITSWAP.md §Flow control).

  /** True if the peer has not exhausted its outbound budget. */
  canServe(peerId: string, projectedBytes: number): boolean {
    const p = this.peers.get(peerId);
    if (!p) return false;
    rollWindow(p.outBudget);
    return p.outBudget.bytes + projectedBytes <= SWARM_BYTE_BUDGET_PER_MIN;
  }

  recordServed(peerId: string, bytes: number): void {
    const p = this.peers.get(peerId);
    if (!p) return;
    rollWindow(p.outBudget);
    p.outBudget.bytes += bytes;
  }

  recordReceived(peerId: string, bytes: number): void {
    const p = this.peers.get(peerId);
    if (!p) return;
    rollWindow(p.inBudget);
    p.inBudget.bytes += bytes;
  }

  /** Snapshot — useful for /admin diagnostics. */
  stats(): {
    peerCount: number;
    totalHaveEntries: number;
    totalInFlight: number;
  } {
    let totalHaves = 0;
    let totalIF = 0;
    for (const [, st] of this.peers) {
      totalHaves += st.haveSet.size;
      totalIF += st.inFlightOut.size;
    }
    return {
      peerCount: this.peers.size,
      totalHaveEntries: totalHaves,
      totalInFlight: totalIF,
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function rollWindow(b: ByteBudget): void {
  const now = Date.now();
  if (now - b.windowStart >= 60_000) {
    b.bytes = 0;
    b.windowStart = now;
  }
}

/** Used by the handler — kept here so other modules don't need to import
 *  SwarmDB internals to build a content-kind tag for log lines. */
export function describeContentKind(k: ContentKind): string {
  return k;
}
