/**
 * manifestDB — R25 / Phase 2 storage for signed community manifests.
 *
 * Each community has a chain of manifests: genesis (version 0) plus
 * monotonically-versioned updates. The latest accepted manifest is the
 * authoritative admin state used by envelope and admin-op verification.
 *
 * Gated by MUSTER_TWO_LAYER=1 (same flag as Phase 1 — manifests are part
 * of the new two-layer model). Legacy `messages` path keeps working
 * regardless.
 *
 * Schema: docs/specs/OPLOG.md §"manifest_update".
 */

import type Database from 'better-sqlite3';

export interface StoredManifest {
  /** SHA-256 of the canonical CBOR (with sig). Primary key. */
  manifestId: Buffer;
  communityId: Buffer;
  version: number;
  owner: Buffer;
  /** SHA-256 of the previous manifest CBOR. NULL at genesis. */
  prevManifestHash: Buffer | null;
  ts: number;
  /** Canonical CBOR of the full manifest, used for re-broadcast and replay. */
  cbor: Buffer;
  receivedAt: number;
}

export class ManifestDB {
  constructor(private db: Database.Database) {
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS manifests (
        manifestId BLOB PRIMARY KEY,
        communityId BLOB NOT NULL,
        version INTEGER NOT NULL,
        owner BLOB NOT NULL,
        prevManifestHash BLOB,
        ts INTEGER NOT NULL,
        cbor BLOB NOT NULL,
        receivedAt INTEGER NOT NULL,
        UNIQUE (communityId, version)
      );
      CREATE INDEX IF NOT EXISTS manifests_by_community_version
        ON manifests (communityId, version);
    `);
  }

  /** Insert. Returns false on duplicate (manifestId or (communityId,version)). */
  store(m: StoredManifest): boolean {
    try {
      const res = this.db.prepare(`
        INSERT OR IGNORE INTO manifests (
          manifestId, communityId, version, owner, prevManifestHash,
          ts, cbor, receivedAt
        ) VALUES (
          @manifestId, @communityId, @version, @owner, @prevManifestHash,
          @ts, @cbor, @receivedAt
        )
      `).run(m);
      return res.changes > 0;
    } catch {
      // UNIQUE violation on (communityId, version) — different fork
      return false;
    }
  }

  get(manifestId: Buffer): StoredManifest | null {
    return (this.db.prepare('SELECT * FROM manifests WHERE manifestId = ?').get(manifestId) as StoredManifest | undefined) ?? null;
  }

  /** Latest accepted version for a community (highest `version`). */
  getLatest(communityId: Buffer): StoredManifest | null {
    return (this.db.prepare(`
      SELECT * FROM manifests
      WHERE communityId = ?
      ORDER BY version DESC
      LIMIT 1
    `).get(communityId) as StoredManifest | undefined) ?? null;
  }

  getByVersion(communityId: Buffer, version: number): StoredManifest | null {
    return (this.db.prepare(`
      SELECT * FROM manifests
      WHERE communityId = ? AND version = ?
    `).get(communityId, version) as StoredManifest | undefined) ?? null;
  }

  /** All manifests for a community, oldest first — for replay. */
  getAll(communityId: Buffer): StoredManifest[] {
    return this.db.prepare(`
      SELECT * FROM manifests
      WHERE communityId = ?
      ORDER BY version ASC
    `).all(communityId) as StoredManifest[];
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM manifests').get() as { n: number }).n;
  }
}
