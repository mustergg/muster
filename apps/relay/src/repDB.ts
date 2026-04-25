/**
 * Reputation DB — R25 / Phase 7.
 *
 * Per-relay storage for peer scores and blacklist windows. Reputation
 * is local — never gossiped across the network (POS.md §Reputation).
 *
 * Schema:
 *   peer_reputation (
 *     peerPubkey       TEXT PRIMARY KEY,  -- peer string nodeId or pubkey hex
 *     score            REAL NOT NULL DEFAULT 0,
 *     lastUpdated      INTEGER NOT NULL,
 *     blacklistedUntil INTEGER            -- ms epoch; NULL when not blacklisted
 *   )
 *
 * peerPubkey is stored as TEXT so we can key it by the same string id
 * peerManager already uses everywhere ("node-<hex>"). Once Ed25519 node
 * keys land at the swarm layer (Phase 7 follow-up), the column accepts
 * a hex pubkey just as well.
 */

import type Database from 'better-sqlite3';

export interface RepRow {
  peerPubkey: string;
  score: number;
  lastUpdated: number;
  blacklistedUntil: number | null;
}

function initRepTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS peer_reputation (
      peerPubkey       TEXT PRIMARY KEY,
      score            REAL    NOT NULL DEFAULT 0,
      lastUpdated      INTEGER NOT NULL,
      blacklistedUntil INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_peerrep_blacklist ON peer_reputation (blacklistedUntil);
  `);
}

export class RepDB {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    initRepTables(db);
    console.log('[relay-db] Peer reputation table initialized.');
  }

  get(peerPubkey: string): RepRow | null {
    const row = this.db.prepare('SELECT * FROM peer_reputation WHERE peerPubkey = ?').get(peerPubkey) as RepRow | undefined;
    return row ?? null;
  }

  upsert(peerPubkey: string, score: number, blacklistedUntil: number | null = null): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO peer_reputation (peerPubkey, score, lastUpdated, blacklistedUntil)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(peerPubkey) DO UPDATE SET
        score            = excluded.score,
        lastUpdated      = excluded.lastUpdated,
        blacklistedUntil = excluded.blacklistedUntil
    `).run(peerPubkey, score, now, blacklistedUntil);
  }

  /** All non-zero rows (for boot warm-up + admin diagnostics). */
  all(): RepRow[] {
    return this.db.prepare('SELECT * FROM peer_reputation ORDER BY score DESC').all() as RepRow[];
  }

  /** Bulk daily decay toward zero by `step`. Returns rows touched. */
  decayAll(step: number, now = Date.now()): number {
    const tx = this.db.transaction(() => {
      const r = this.db.prepare(`
        UPDATE peer_reputation
        SET score = CASE
              WHEN score > 0 THEN MAX(0, score - ?)
              WHEN score < 0 THEN MIN(0, score + ?)
              ELSE score
            END,
            lastUpdated = ?
        WHERE score <> 0
      `).run(step, step, now);
      return r.changes;
    });
    return tx();
  }

  /** Drop expired blacklists (blacklistedUntil < now). */
  clearExpiredBlacklist(now = Date.now()): number {
    const r = this.db.prepare(`
      UPDATE peer_reputation
      SET blacklistedUntil = NULL
      WHERE blacklistedUntil IS NOT NULL AND blacklistedUntil < ?
    `).run(now);
    return r.changes;
  }
}
