/**
 * DmRoutingDB — R25 / Phase 8.
 *
 * Sealed-sender DM routing state. Two tables:
 *
 *   inbox_subscriptions (
 *     subId        TEXT PRIMARY KEY,           -- inboxHashHex || ':' || peerOrClientId
 *     inboxHashHex TEXT NOT NULL,              -- 32-byte hash, hex
 *     subscriberId TEXT NOT NULL,              -- local clientId or remote peerId
 *     local        INTEGER NOT NULL,           -- 1 = browser client on this relay,
 *                                              -- 0 = remote peer relay
 *     expiresAt    INTEGER NOT NULL            -- ms epoch
 *   )
 *
 *   orphan_dm (
 *     dmId         TEXT PRIMARY KEY,           -- sha256(canonicalCBOR(frame)) hex
 *     inboxHashHex TEXT NOT NULL,
 *     frameCBOR    BLOB NOT NULL,              -- canonical CBOR of DmFrame
 *     ts           INTEGER NOT NULL,           -- ms epoch
 *     attempts     INTEGER NOT NULL DEFAULT 0,
 *     lastTryAt    INTEGER
 *   )
 *
 * Per DM.md §Routing:
 *   - orphan retention 24h
 *   - retry every 15 min
 *   - max 50 orphans per inbox hash, oldest evicted
 *
 * Subscriptions live for 2 windows (12h) on the relay so a brief client
 * disconnect doesn't drop their inbox; refreshed by the client each time
 * it reconnects.
 */

import type Database from 'better-sqlite3';
import {
  DM_ORPHAN_TTL_MS,
  DM_RATE_ORPHAN_LIMIT,
} from '@muster/protocol';

export interface SubscriptionRow {
  subId: string;
  inboxHashHex: string;
  subscriberId: string;
  local: 0 | 1;
  expiresAt: number;
}

export interface OrphanRow {
  dmId: string;
  inboxHashHex: string;
  frameCBOR: Buffer;
  ts: number;
  attempts: number;
  lastTryAt: number | null;
}

function initDmRoutingTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inbox_subscriptions (
      subId        TEXT PRIMARY KEY,
      inboxHashHex TEXT NOT NULL,
      subscriberId TEXT NOT NULL,
      local        INTEGER NOT NULL,
      expiresAt    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inboxsub_hash    ON inbox_subscriptions (inboxHashHex, expiresAt);
    CREATE INDEX IF NOT EXISTS idx_inboxsub_subId   ON inbox_subscriptions (subscriberId);
    CREATE INDEX IF NOT EXISTS idx_inboxsub_expires ON inbox_subscriptions (expiresAt);

    CREATE TABLE IF NOT EXISTS orphan_dm (
      dmId         TEXT PRIMARY KEY,
      inboxHashHex TEXT NOT NULL,
      frameCBOR    BLOB NOT NULL,
      ts           INTEGER NOT NULL,
      attempts     INTEGER NOT NULL DEFAULT 0,
      lastTryAt    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_orphan_inbox ON orphan_dm (inboxHashHex, ts);
    CREATE INDEX IF NOT EXISTS idx_orphan_ts    ON orphan_dm (ts);
  `);
}

export class DmRoutingDB {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    initDmRoutingTables(db);
    console.log('[relay-db] DM routing tables initialized.');
  }

  // ── Subscriptions ───────────────────────────────────────────────────────

  upsertSubscription(args: {
    inboxHashHex: string;
    subscriberId: string;
    local: boolean;
    expiresAt: number;
  }): void {
    const subId = `${args.inboxHashHex}:${args.subscriberId}`;
    this.db.prepare(`
      INSERT INTO inbox_subscriptions (subId, inboxHashHex, subscriberId, local, expiresAt)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(subId) DO UPDATE SET
        expiresAt = excluded.expiresAt,
        local     = excluded.local
    `).run(subId, args.inboxHashHex, args.subscriberId, args.local ? 1 : 0, args.expiresAt);
  }

  removeSubscription(inboxHashHex: string, subscriberId: string): void {
    this.db.prepare(`DELETE FROM inbox_subscriptions WHERE subId = ?`)
      .run(`${inboxHashHex}:${subscriberId}`);
  }

  /** All subscribers for an inbox hash, filtered by `local` flag. */
  subscribersFor(inboxHashHex: string, now = Date.now()): SubscriptionRow[] {
    return this.db.prepare(`
      SELECT * FROM inbox_subscriptions
      WHERE inboxHashHex = ? AND expiresAt > ?
    `).all(inboxHashHex, now) as SubscriptionRow[];
  }

  /** All distinct inbox hashes the relay is currently watching (local + remote). */
  allActiveInboxHashes(now = Date.now()): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT inboxHashHex FROM inbox_subscriptions WHERE expiresAt > ?
    `).all(now) as Array<{ inboxHashHex: string }>;
    return rows.map((r) => r.inboxHashHex);
  }

  /** Inbox hashes with at least one *local* (browser-client) subscriber.
   *  These are the ones we should advertise into the DHT. */
  locallySubscribedInboxHashes(now = Date.now()): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT inboxHashHex FROM inbox_subscriptions
      WHERE local = 1 AND expiresAt > ?
    `).all(now) as Array<{ inboxHashHex: string }>;
    return rows.map((r) => r.inboxHashHex);
  }

  removeSubscriberAll(subscriberId: string): number {
    return this.db.prepare(`DELETE FROM inbox_subscriptions WHERE subscriberId = ?`)
      .run(subscriberId).changes;
  }

  pruneExpiredSubscriptions(now = Date.now()): number {
    return this.db.prepare(`DELETE FROM inbox_subscriptions WHERE expiresAt <= ?`)
      .run(now).changes;
  }

  // ── Orphans ─────────────────────────────────────────────────────────────

  insertOrphan(row: { dmId: string; inboxHashHex: string; frameCBOR: Buffer; ts: number }): void {
    // Enforce DM_RATE_ORPHAN_LIMIT per inbox hash — evict oldest if needed.
    const count = this.db.prepare(`SELECT COUNT(*) AS n FROM orphan_dm WHERE inboxHashHex = ?`)
      .get(row.inboxHashHex) as { n: number };
    if (count.n >= DM_RATE_ORPHAN_LIMIT) {
      this.db.prepare(`
        DELETE FROM orphan_dm
        WHERE dmId IN (
          SELECT dmId FROM orphan_dm WHERE inboxHashHex = ? ORDER BY ts ASC LIMIT ?
        )
      `).run(row.inboxHashHex, count.n - DM_RATE_ORPHAN_LIMIT + 1);
    }
    this.db.prepare(`
      INSERT OR IGNORE INTO orphan_dm (dmId, inboxHashHex, frameCBOR, ts, attempts, lastTryAt)
      VALUES (?, ?, ?, ?, 0, NULL)
    `).run(row.dmId, row.inboxHashHex, row.frameCBOR, row.ts);
  }

  /** Orphans for a given inbox hash (used when a fresh subscriber arrives). */
  orphansFor(inboxHashHex: string): OrphanRow[] {
    return this.db.prepare(`
      SELECT * FROM orphan_dm WHERE inboxHashHex = ? ORDER BY ts ASC
    `).all(inboxHashHex) as OrphanRow[];
  }

  /** All orphans whose lastTryAt is older than `staleAfter` ms. */
  orphansToRetry(now = Date.now(), retryIntervalMs: number): OrphanRow[] {
    return this.db.prepare(`
      SELECT * FROM orphan_dm
      WHERE lastTryAt IS NULL OR (? - lastTryAt) >= ?
      ORDER BY ts ASC
    `).all(now, retryIntervalMs) as OrphanRow[];
  }

  markOrphanRetried(dmId: string, now = Date.now()): void {
    this.db.prepare(`
      UPDATE orphan_dm SET attempts = attempts + 1, lastTryAt = ? WHERE dmId = ?
    `).run(now, dmId);
  }

  deleteOrphan(dmId: string): void {
    this.db.prepare(`DELETE FROM orphan_dm WHERE dmId = ?`).run(dmId);
  }

  pruneExpiredOrphans(now = Date.now()): number {
    return this.db.prepare(`DELETE FROM orphan_dm WHERE (? - ts) > ?`)
      .run(now, DM_ORPHAN_TTL_MS).changes;
  }

  stats(): { subscriptions: number; localInboxes: number; orphans: number } {
    const sub = this.db.prepare(`SELECT COUNT(*) AS n FROM inbox_subscriptions`).get() as { n: number };
    const loc = this.db.prepare(`SELECT COUNT(DISTINCT inboxHashHex) AS n FROM inbox_subscriptions WHERE local = 1`).get() as { n: number };
    const orp = this.db.prepare(`SELECT COUNT(*) AS n FROM orphan_dm`).get() as { n: number };
    return { subscriptions: sub.n, localInboxes: loc.n, orphans: orp.n };
  }
}
