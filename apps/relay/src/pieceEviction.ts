/**
 * pieceEviction — R25 / Phase 4.
 *
 * Tier-aware eviction scheduler for blob pieces.
 *
 * Policy (docs/roadmap/BETA_ROADMAP.md §Phase 4):
 *   - 90 / 10 split between hosted-community content and network cache.
 *   - Hosted-community pieces are PINNED (not candidates for eviction).
 *   - Everything else is cache; evicted LRU once the cache share fills up.
 *
 * Decision surface for "is this piece hosted?":
 *   A piece is hosted iff ANY of the blobs that reference it belongs to a
 *   hosted community. Blob ↔ community link is derived from the envelope
 *   that first introduced the blobRef — we look that up via envelopeDB.
 *
 * The scheduler runs on a long interval (default 10 min) and on demand
 * when the pieces table grows past a soft cap. Legacy `blobDB.evictLRUPieces`
 * keeps working as the low-level cursor; this module picks which bytes it
 * is allowed to free.
 *
 * Gated behind MUSTER_TWO_LAYER=1 via the top-level wiring in `index.ts`.
 */

import type Database from 'better-sqlite3';
import type { BlobDB } from './blobDB';
import type { EnvelopeDB } from './envelopeDB';
import type { TierManager } from './nodeTier';

// ─── Config ─────────────────────────────────────────────────────────────────

/** Default soft cap for total piece bytes on disk (2 GB). */
export const DEFAULT_PIECE_BYTE_CAP = 2 * 1024 * 1024 * 1024;

/** Share of the cap reserved for hosted content. Cache gets the remainder. */
export const HOSTED_SHARE = 0.9;

/** How often the scheduler sweeps. */
export const EVICTION_INTERVAL_MS = 10 * 60 * 1000;

export interface PieceEvictionConfig {
  /** Soft cap on piece byte usage. Eviction kicks in when usage > cap. */
  maxBytes: number;
  /** Interval between scheduled sweeps. */
  intervalMs: number;
  /** Env override — disables the automatic sweeper. Manual `sweep()` still works. */
  disableScheduler?: boolean;
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export interface PieceUsageStats {
  totalBytes: number;
  pinnedBytes: number;        // pieces referenced by ≥1 hosted-community blob
  cacheBytes: number;         // totalBytes - pinnedBytes
  pieceCount: number;
  hostedPieceCount: number;
  cachedPieceCount: number;
  pinnedCap: number;          // maxBytes * HOSTED_SHARE
  cacheCap: number;           // maxBytes * (1 - HOSTED_SHARE)
}

// ─── Scheduler ──────────────────────────────────────────────────────────────

export class PieceEvictor {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private db: Database.Database,
    private blobDB: BlobDB,
    private envelopeDB: EnvelopeDB,
    private tierManager: TierManager,
    private config: PieceEvictionConfig = {
      maxBytes: DEFAULT_PIECE_BYTE_CAP,
      intervalMs: EVICTION_INTERVAL_MS,
    },
  ) {}

  start(): void {
    if (this.timer) return;
    if (this.config.disableScheduler) return;
    // First sweep slightly after startup so boot isn't slowed.
    this.timer = setInterval(() => {
      try { this.sweep(); } catch (err) { console.warn('[pieceEviction] sweep failed:', err); }
    }, this.config.intervalMs);
    // `unref` so it doesn't keep the event loop alive at shutdown.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /**
   * Run one eviction pass. Returns bytes freed. Idempotent — safe to call
   * whenever the caller thinks disk pressure is high.
   */
  sweep(): number {
    const stats = this.stats();
    if (stats.totalBytes <= this.config.maxBytes) return 0;

    // Cache overspill first — that's what the 90/10 policy protects us from.
    let toFree = 0;
    if (stats.cacheBytes > stats.cacheCap) {
      toFree = stats.cacheBytes - stats.cacheCap;
    } else if (stats.totalBytes > this.config.maxBytes) {
      // Even pinned + cache together blow the cap — free the cache fully.
      // Pinned bytes stay (by policy).
      toFree = stats.cacheBytes;
    }
    if (toFree <= 0) return 0;

    const freed = this.evictCacheLRU(toFree);
    if (freed > 0) {
      console.log(`[pieceEviction] freed ${formatBytes(freed)} of cache`);
    }
    return freed;
  }

  /**
   * Evict up to `maxBytesToFree` bytes of *cache* pieces (i.e. not pinned
   * by a hosted community). Deletes from the `pieces` table only; blob
   * metadata + link rows are left intact. A re-fetch will repopulate.
   */
  evictCacheLRU(maxBytesToFree: number): number {
    // Candidates = pieces with refCount >= 0 (spec: pieces live as long as
    // some blob_pieces row references them). Hosted filter: no ancestor
    // envelope whose `communityId` is hosted.
    const hostedCommunityIds = this.hostedCommunityBytes();
    const hostedSet = new Set(hostedCommunityIds);

    const rows = this.db.prepare(`
      SELECT p.pieceId AS pieceId, p.size AS size, p.lastAccessedAt AS lastAccessedAt
      FROM pieces p
      ORDER BY p.lastAccessedAt ASC
    `).all() as { pieceId: Buffer; size: number; lastAccessedAt: number }[];

    const del = this.db.prepare('DELETE FROM pieces WHERE pieceId = ?');
    const unlink = this.db.prepare('DELETE FROM blob_pieces WHERE pieceId = ?');
    let freed = 0;

    for (const row of rows) {
      if (freed >= maxBytesToFree) break;
      if (this.isPiecePinned(row.pieceId, hostedSet)) continue;
      const tx = this.db.transaction((pid: Buffer) => {
        unlink.run(pid);
        del.run(pid);
      });
      tx(row.pieceId);
      freed += row.size;
    }
    return freed;
  }

  /** Snapshot of piece usage. */
  stats(): PieceUsageStats {
    const hostedSet = new Set(this.hostedCommunityBytes());

    const totalRow = this.db.prepare(
      'SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS b FROM pieces'
    ).get() as { n: number; b: number };

    // Pinned: pieces referenced by at least one blob whose community is
    // hosted. Uses the envelope→blobRoot mapping captured by envelopeDB.
    //
    // NOTE: In Phase 1 envelopeDB stores `communityId` + `blobRoot` as
    // separate columns. We join on blob_pieces.root = envelopes.blobRoot.
    const pinned = this.db.prepare(`
      SELECT p.pieceId AS pieceId, p.size AS size
      FROM pieces p
      WHERE EXISTS (
        SELECT 1 FROM blob_pieces bp
        JOIN envelopes e ON e.blobRoot = bp.root
        WHERE bp.pieceId = p.pieceId
      )
    `).all() as { pieceId: Buffer; size: number }[];

    let pinnedBytes = 0;
    let hostedCount = 0;
    for (const r of pinned) {
      // Re-check hosted-community filter — the join above covers "any envelope",
      // but not "any HOSTED community's envelope". Compact enough to do in JS.
      const envRows = this.db.prepare(`
        SELECT e.communityId AS communityId
        FROM envelopes e
        JOIN blob_pieces bp ON bp.root = e.blobRoot
        WHERE bp.pieceId = ?
      `).all(r.pieceId) as { communityId: Buffer }[];
      const anyHosted = envRows.some((row) => hostedSet.has(row.communityId.toString('hex')));
      if (anyHosted) {
        pinnedBytes += r.size;
        hostedCount += 1;
      }
    }

    const cacheBytes = totalRow.b - pinnedBytes;
    return {
      totalBytes: totalRow.b,
      pinnedBytes,
      cacheBytes,
      pieceCount: totalRow.n,
      hostedPieceCount: hostedCount,
      cachedPieceCount: totalRow.n - hostedCount,
      pinnedCap: Math.floor(this.config.maxBytes * HOSTED_SHARE),
      cacheCap: Math.floor(this.config.maxBytes * (1 - HOSTED_SHARE)),
    };
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  /**
   * A piece is pinned iff ANY envelope referencing its blob root belongs
   * to a hosted community.
   */
  private isPiecePinned(pieceId: Buffer, hostedSet: Set<string>): boolean {
    const rows = this.db.prepare(`
      SELECT e.communityId AS communityId
      FROM envelopes e
      JOIN blob_pieces bp ON bp.root = e.blobRoot
      WHERE bp.pieceId = ?
    `).all(pieceId) as { communityId: Buffer }[];
    for (const r of rows) {
      if (hostedSet.has(r.communityId.toString('hex'))) return true;
    }
    return false;
  }

  private hostedCommunityBytes(): string[] {
    // Snapshot via TierManager — caller isHosted per id. We read all distinct
    // community ids that currently have an envelope on disk, then filter.
    const rows = this.db.prepare(`
      SELECT DISTINCT communityId FROM envelopes
    `).all() as { communityId: Buffer }[];
    return rows
      .map((r) => r.communityId.toString('hex'))
      .filter((id) => this.tierManager.isHosted(id));
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}
