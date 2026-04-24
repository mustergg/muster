/**
 * envelopeDB — Phase 1 storage for the two-layer envelope model.
 *
 * Gated by MUSTER_TWO_LAYER=1. The legacy `messages` table in
 * database.ts stays the source of truth until Phase 10.
 *
 * Schema: docs/specs/ENVELOPE.md. Hash-addressed by envelopeId
 * (SHA-256 of canonical CBOR including signature).
 */

import type Database from 'better-sqlite3';

export interface StoredEnvelope {
  envelopeId: Buffer;
  communityId: Buffer;
  channelId: Buffer;
  senderPubkey: Buffer;
  ts: number;
  kind: string;
  hasBlob: 0 | 1;
  blobRoot: Buffer | null;
  replyTo: Buffer | null;
  edits: Buffer | null;
  tombstones: Buffer | null;
  cbor: Buffer;            // canonical CBOR of the full envelope (with sig)
  receivedAt: number;
}

export class EnvelopeDB {
  constructor(private db: Database.Database) {
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS envelopes (
        envelopeId BLOB PRIMARY KEY,
        communityId BLOB NOT NULL,
        channelId BLOB NOT NULL,
        senderPubkey BLOB NOT NULL,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        hasBlob INTEGER NOT NULL,
        blobRoot BLOB,
        replyTo BLOB,
        edits BLOB,
        tombstones BLOB,
        cbor BLOB NOT NULL,
        receivedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS envelopes_by_channel_ts
        ON envelopes (channelId, ts);
      CREATE INDEX IF NOT EXISTS envelopes_by_community_ts
        ON envelopes (communityId, ts);
      CREATE INDEX IF NOT EXISTS envelopes_by_blob
        ON envelopes (blobRoot) WHERE hasBlob = 1;
    `);
  }

  /** Insert. Silently ignores duplicate envelopeId. */
  store(env: StoredEnvelope): boolean {
    const res = this.db.prepare(`
      INSERT OR IGNORE INTO envelopes (
        envelopeId, communityId, channelId, senderPubkey, ts, kind,
        hasBlob, blobRoot, replyTo, edits, tombstones, cbor, receivedAt
      ) VALUES (
        @envelopeId, @communityId, @channelId, @senderPubkey, @ts, @kind,
        @hasBlob, @blobRoot, @replyTo, @edits, @tombstones, @cbor, @receivedAt
      )
    `).run(env);
    return res.changes > 0;
  }

  get(envelopeId: Buffer): StoredEnvelope | null {
    return (this.db.prepare('SELECT * FROM envelopes WHERE envelopeId = ?').get(envelopeId) as StoredEnvelope | undefined) ?? null;
  }

  getByChannel(channelId: Buffer, since: number, limit = 500): StoredEnvelope[] {
    return this.db.prepare(`
      SELECT * FROM envelopes
      WHERE channelId = ? AND ts > ?
      ORDER BY ts ASC
      LIMIT ?
    `).all(channelId, since, limit) as StoredEnvelope[];
  }

  deleteByChannel(channelId: Buffer): number {
    return this.db.prepare('DELETE FROM envelopes WHERE channelId = ?').run(channelId).changes;
  }

  deleteOlderThan(cutoffTs: number, exceptCommunities: Buffer[]): number {
    if (exceptCommunities.length === 0) {
      return this.db.prepare('DELETE FROM envelopes WHERE ts < ?').run(cutoffTs).changes;
    }
    const placeholders = exceptCommunities.map(() => '?').join(',');
    return this.db.prepare(
      `DELETE FROM envelopes WHERE ts < ? AND communityId NOT IN (${placeholders})`,
    ).run(cutoffTs, ...exceptCommunities).changes;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM envelopes').get() as { n: number }).n;
  }
}
