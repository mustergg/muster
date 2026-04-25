/**
 * opLogDB — R25 / Phase 3 storage for community admin ops.
 *
 * Append-only log of causally-ordered administrative actions (promote,
 * kick, channel create, etc.). Each op carries `prevOpHash` pointing at
 * the most-recent op its author had seen; this yields a DAG that a
 * materialiser can fold into current admin state.
 *
 * Gated by MUSTER_TWO_LAYER=1 (same flag as Phases 1 & 2).
 *
 * Schema: docs/specs/OPLOG.md §Storage.
 */

import type Database from 'better-sqlite3';

export interface StoredOp {
  /** SHA-256 of the canonical CBOR (signature included). Primary key. */
  opId: Buffer;
  communityId: Buffer;
  opType: string;
  /** Canonical CBOR of `args`. Schema per opType. */
  argsCBOR: Buffer;
  authorPubkey: Buffer;
  ts: number;
  /** 32 bytes; NULL at genesis. */
  prevOpHash: Buffer | null;
  sig: Buffer;
  receivedAt: number;
}

export class OpLogDB {
  constructor(private db: Database.Database) {
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS community_ops (
        opId BLOB PRIMARY KEY,
        communityId BLOB NOT NULL,
        opType TEXT NOT NULL,
        argsCBOR BLOB NOT NULL,
        authorPubkey BLOB NOT NULL,
        ts INTEGER NOT NULL,
        prevOpHash BLOB,
        sig BLOB NOT NULL,
        receivedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ops_by_community ON community_ops(communityId, ts);
      CREATE INDEX IF NOT EXISTS ops_by_parent    ON community_ops(communityId, prevOpHash);
    `);
  }

  /** Insert. Idempotent — duplicate opId is silently ignored. Returns false on dup. */
  store(op: StoredOp): boolean {
    const res = this.db.prepare(`
      INSERT OR IGNORE INTO community_ops (
        opId, communityId, opType, argsCBOR, authorPubkey,
        ts, prevOpHash, sig, receivedAt
      ) VALUES (
        @opId, @communityId, @opType, @argsCBOR, @authorPubkey,
        @ts, @prevOpHash, @sig, @receivedAt
      )
    `).run(op);
    return res.changes > 0;
  }

  get(opId: Buffer): StoredOp | null {
    return (this.db.prepare('SELECT * FROM community_ops WHERE opId = ?').get(opId) as StoredOp | undefined) ?? null;
  }

  has(opId: Buffer): boolean {
    return !!this.db.prepare('SELECT 1 FROM community_ops WHERE opId = ?').get(opId);
  }

  /** Every op for a community, oldest-first by advisory ts — used for replay. */
  getAll(communityId: Buffer): StoredOp[] {
    return this.db.prepare(`
      SELECT * FROM community_ops
      WHERE communityId = ?
      ORDER BY ts ASC, opId ASC
    `).all(communityId) as StoredOp[];
  }

  /** Children that name `parentOpId` in `prevOpHash`. */
  getChildrenOf(communityId: Buffer, parentOpId: Buffer): StoredOp[] {
    return this.db.prepare(`
      SELECT * FROM community_ops
      WHERE communityId = ? AND prevOpHash = ?
      ORDER BY ts ASC, opId ASC
    `).all(communityId, parentOpId) as StoredOp[];
  }

  /** The single genesis op for a community (prevOpHash IS NULL), if any. */
  getGenesis(communityId: Buffer): StoredOp | null {
    return (this.db.prepare(`
      SELECT * FROM community_ops
      WHERE communityId = ? AND prevOpHash IS NULL
      ORDER BY ts ASC, opId ASC
      LIMIT 1
    `).get(communityId) as StoredOp | undefined) ?? null;
  }

  /** R25 — Phase 5. Enumerate every op id we hold. Used by the swarm
   *  layer to populate HAVE_ANNOUNCE on peer connect. */
  allOpIds(): Buffer[] {
    return (this.db.prepare('SELECT opId FROM community_ops').all() as { opId: Buffer }[])
      .map((r) => r.opId);
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM community_ops').get() as { n: number }).n;
  }

  /** Count per community — used by admin endpoints/monitoring. */
  countForCommunity(communityId: Buffer): number {
    return (this.db.prepare(
      'SELECT COUNT(*) AS n FROM community_ops WHERE communityId = ?'
    ).get(communityId) as { n: number }).n;
  }
}
