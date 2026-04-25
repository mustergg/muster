/**
 * ReputationManager — R25 / Phase 7.
 *
 * Local floating-point score per peer. Bounded [-100, +100]. Persisted via
 * RepDB; mirrored in memory so hot paths (BitSwap provider selection,
 * inbound message admission) avoid SQLite per-decision.
 *
 * Reputation is **never** synchronised across nodes (POS.md §Reputation).
 * Each relay forms its own opinion.
 *
 * Event table (POS.md §Reputation):
 *   POS_OK              +1
 *   POS_BAD             -5
 *   POS_TIMEOUT         -5
 *   WANT_HASH_MISMATCH  -1
 *   WANT_PROOF_MISMATCH -5
 *   SERVED_MB           +0.1 per MB
 *
 * Threshold table (POS.md §Thresholds):
 *   ≥ +10                preferred
 *   0 ≤ s < +10          normal
 *  -20 ≤ s < 0           de-prioritised
 *   s < -20              blacklisted 24 h, then reset to -10
 *
 * Daily decay: ±1 toward 0 (handled by RepDB.decayAll, scheduled in
 * index.ts).
 */

import { RepDB, type RepRow } from './repDB';

export const REP_MIN = -100;
export const REP_MAX = +100;
export const REP_PREFERRED = +10;
export const REP_DEPRIORITISED = -20;

export const REP_BLACKLIST_DURATION_MS = 24 * 60 * 60 * 1000;
export const REP_RESET_AFTER_BLACKLIST = -10;

export type RepEvent =
  | 'POS_OK'
  | 'POS_BAD'
  | 'POS_TIMEOUT'
  | 'WANT_HASH_MISMATCH'
  | 'WANT_PROOF_MISMATCH';

const EVENT_DELTAS: Record<RepEvent, number> = {
  POS_OK: +1,
  POS_BAD: -5,
  POS_TIMEOUT: -5,
  WANT_HASH_MISMATCH: -1,
  WANT_PROOF_MISMATCH: -5,
};

interface MemRow {
  score: number;
  blacklistedUntil: number | null;
  dirty: boolean;
}

export interface ReputationStats {
  tracked: number;
  preferred: number;
  deprioritised: number;
  blacklisted: number;
  totalChallengesIssued: number;
  totalChallengesPassed: number;
  totalChallengesFailed: number;
  totalChallengesTimedOut: number;
}

export class ReputationManager {
  private repDB: RepDB;
  private mem = new Map<string, MemRow>();

  // Local-only counters (POS.md §Observability).
  private challengesIssued = 0;
  private challengesPassed = 0;
  private challengesFailed = 0;
  private challengesTimedOut = 0;

  constructor(repDB: RepDB) {
    this.repDB = repDB;
    for (const r of repDB.all()) {
      this.mem.set(r.peerPubkey, {
        score: r.score,
        blacklistedUntil: r.blacklistedUntil,
        dirty: false,
      });
    }
  }

  // ── Reads ───────────────────────────────────────────────────────────────

  getScore(peerId: string): number {
    return this.mem.get(peerId)?.score ?? 0;
  }

  isBlacklisted(peerId: string, now = Date.now()): boolean {
    const m = this.mem.get(peerId);
    if (!m || m.blacklistedUntil == null) return false;
    if (m.blacklistedUntil <= now) {
      // Lift the blacklist and reset (POS.md threshold table).
      m.blacklistedUntil = null;
      m.score = REP_RESET_AFTER_BLACKLIST;
      m.dirty = true;
      this.flush(peerId);
      return false;
    }
    return true;
  }

  isPreferred(peerId: string): boolean { return this.getScore(peerId) >= REP_PREFERRED; }
  isDeprioritised(peerId: string): boolean {
    const s = this.getScore(peerId);
    return s < 0 && s >= REP_DEPRIORITISED;
  }

  /** Snapshot for admin UI / debugging. */
  snapshot(): ReputationStats {
    let preferred = 0;
    let deprioritised = 0;
    let blacklisted = 0;
    const now = Date.now();
    for (const [, m] of this.mem) {
      if (m.blacklistedUntil != null && m.blacklistedUntil > now) blacklisted++;
      else if (m.score >= REP_PREFERRED) preferred++;
      else if (m.score < 0 && m.score >= REP_DEPRIORITISED) deprioritised++;
    }
    return {
      tracked: this.mem.size,
      preferred,
      deprioritised,
      blacklisted,
      totalChallengesIssued: this.challengesIssued,
      totalChallengesPassed: this.challengesPassed,
      totalChallengesFailed: this.challengesFailed,
      totalChallengesTimedOut: this.challengesTimedOut,
    };
  }

  perPeer(): Array<{ peerId: string; score: number; blacklistedUntil: number | null }> {
    const out: Array<{ peerId: string; score: number; blacklistedUntil: number | null }> = [];
    for (const [peerId, m] of this.mem) {
      out.push({ peerId, score: round2(m.score), blacklistedUntil: m.blacklistedUntil });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  // ── Writes ──────────────────────────────────────────────────────────────

  /** Apply a categorised event. Returns the new score. */
  applyEvent(peerId: string, event: RepEvent): number {
    return this.adjust(peerId, EVENT_DELTAS[event], event);
  }

  /** Add `mbServed * 0.1` for a successful piece serve. */
  addServedMB(peerId: string, mbServed: number): number {
    if (!(mbServed > 0)) return this.getScore(peerId);
    return this.adjust(peerId, mbServed * 0.1, 'SERVED_MB');
  }

  /** Manual override (admin tool). */
  setScore(peerId: string, score: number): number {
    const m = this.ensure(peerId);
    m.score = clamp(score, REP_MIN, REP_MAX);
    m.dirty = true;
    this.flush(peerId);
    return m.score;
  }

  /** Counter accessors used by PosManager. */
  noteChallengeIssued(): void { this.challengesIssued++; }
  noteChallengePassed(): void { this.challengesPassed++; }
  noteChallengeFailed(): void { this.challengesFailed++; }
  noteChallengeTimedOut(): void { this.challengesTimedOut++; }

  // ── Maintenance ─────────────────────────────────────────────────────────

  /** Daily decay sweep (1 point toward 0). Call from a once-per-day timer. */
  decayDaily(step = 1): number {
    const now = Date.now();
    let touched = 0;
    for (const [peerId, m] of this.mem) {
      if (m.score === 0) continue;
      if (m.score > 0) m.score = Math.max(0, m.score - step);
      else m.score = Math.min(0, m.score + step);
      m.dirty = true;
      touched++;
      // Persist later in bulk; flush each row to keep memory authoritative.
      this.flush(peerId);
    }
    // Also drop expired blacklists at the DB level so manual SQL queries
    // stay consistent.
    this.repDB.clearExpiredBlacklist(now);
    return touched;
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private ensure(peerId: string): MemRow {
    let m = this.mem.get(peerId);
    if (!m) {
      m = { score: 0, blacklistedUntil: null, dirty: false };
      this.mem.set(peerId, m);
    }
    return m;
  }

  private adjust(peerId: string, delta: number, _reason: string): number {
    const m = this.ensure(peerId);
    if (m.blacklistedUntil != null && m.blacklistedUntil > Date.now()) {
      // Already blacklisted — accumulate but don't lift early.
      m.score = clamp(m.score + delta, REP_MIN, REP_MAX);
      m.dirty = true;
      this.flush(peerId);
      return m.score;
    }
    m.score = clamp(m.score + delta, REP_MIN, REP_MAX);
    if (m.score < REP_DEPRIORITISED) {
      m.blacklistedUntil = Date.now() + REP_BLACKLIST_DURATION_MS;
    }
    m.dirty = true;
    this.flush(peerId);
    return m.score;
  }

  private flush(peerId: string): void {
    const m = this.mem.get(peerId);
    if (!m || !m.dirty) return;
    this.repDB.upsert(peerId, m.score, m.blacklistedUntil);
    m.dirty = false;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

// Unused export silencer for type-only RepRow consumers.
export type { RepRow };
