/**
 * blobDB — Phase 1 storage for blob metadata and pieces.
 *
 * Two tables share one file:
 *   - blobs     — per-blob metadata (root, size, mime, pieceCount, pieceSize).
 *   - pieces    — content-addressed 256-KB chunks of ciphertext.
 *   - blob_pieces — m:n linking blobs to their ordered pieces.
 *
 * Pieces are keyed by their SHA-256 id so identical bytes across different
 * blobs deduplicate at the row level. See docs/specs/BLOB.md.
 */

import type Database from 'better-sqlite3';

export interface StoredBlob {
  root: Buffer;
  size: number;
  mime: string;
  pieceCount: number;
  pieceSize: number;
  firstSeenAt: number;
}

export interface StoredPiece {
  pieceId: Buffer;
  bytes: Buffer;
  size: number;
  refCount: number;
  lastAccessedAt: number;
}

export class BlobDB {
  constructor(private db: Database.Database) {
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS blobs (
        root BLOB PRIMARY KEY,
        size INTEGER NOT NULL,
        mime TEXT NOT NULL,
        pieceCount INTEGER NOT NULL,
        pieceSize INTEGER NOT NULL,
        firstSeenAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pieces (
        pieceId BLOB PRIMARY KEY,
        bytes BLOB NOT NULL,
        size INTEGER NOT NULL,
        refCount INTEGER NOT NULL DEFAULT 0,
        lastAccessedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS blob_pieces (
        root BLOB NOT NULL,
        pieceIdx INTEGER NOT NULL,
        pieceId BLOB NOT NULL,
        PRIMARY KEY (root, pieceIdx)
      );
      CREATE INDEX IF NOT EXISTS blob_pieces_by_piece
        ON blob_pieces (pieceId);
    `);
  }

  // ─── Blob metadata ─────────────────────────────────────────────────────

  storeBlob(blob: StoredBlob): boolean {
    const res = this.db.prepare(`
      INSERT OR IGNORE INTO blobs (root, size, mime, pieceCount, pieceSize, firstSeenAt)
      VALUES (@root, @size, @mime, @pieceCount, @pieceSize, @firstSeenAt)
    `).run(blob);
    return res.changes > 0;
  }

  getBlob(root: Buffer): StoredBlob | null {
    return (this.db.prepare('SELECT * FROM blobs WHERE root = ?').get(root) as StoredBlob | undefined) ?? null;
  }

  deleteBlob(root: Buffer): void {
    const tx = this.db.transaction((r: Buffer) => {
      const rows = this.db.prepare('SELECT pieceId FROM blob_pieces WHERE root = ?').all(r) as { pieceId: Buffer }[];
      this.db.prepare('DELETE FROM blob_pieces WHERE root = ?').run(r);
      this.db.prepare('DELETE FROM blobs WHERE root = ?').run(r);
      const dec = this.db.prepare('UPDATE pieces SET refCount = refCount - 1 WHERE pieceId = ?');
      for (const { pieceId } of rows) dec.run(pieceId);
      this.db.prepare('DELETE FROM pieces WHERE refCount <= 0').run();
    });
    tx(root);
  }

  // ─── Pieces ─────────────────────────────────────────────────────────────

  /** Insert or refresh a piece. Increments nothing — see linkPiece. */
  upsertPiece(piece: StoredPiece): void {
    this.db.prepare(`
      INSERT INTO pieces (pieceId, bytes, size, refCount, lastAccessedAt)
      VALUES (@pieceId, @bytes, @size, @refCount, @lastAccessedAt)
      ON CONFLICT(pieceId) DO UPDATE SET
        lastAccessedAt = excluded.lastAccessedAt
    `).run(piece);
  }

  getPiece(pieceId: Buffer): StoredPiece | null {
    const row = this.db.prepare('SELECT * FROM pieces WHERE pieceId = ?').get(pieceId) as StoredPiece | undefined;
    if (row) {
      this.db.prepare('UPDATE pieces SET lastAccessedAt = ? WHERE pieceId = ?').run(Date.now(), pieceId);
    }
    return row ?? null;
  }

  hasPiece(pieceId: Buffer): boolean {
    return this.db.prepare('SELECT 1 FROM pieces WHERE pieceId = ?').get(pieceId) != null;
  }

  // ─── Blob ↔ piece linking ─────────────────────────────────────────────

  linkPiece(root: Buffer, pieceIdx: number, pieceId: Buffer): void {
    const ins = this.db.prepare(`
      INSERT OR IGNORE INTO blob_pieces (root, pieceIdx, pieceId)
      VALUES (?, ?, ?)
    `).run(root, pieceIdx, pieceId);
    if (ins.changes > 0) {
      this.db.prepare('UPDATE pieces SET refCount = refCount + 1 WHERE pieceId = ?').run(pieceId);
    }
  }

  getBlobPieces(root: Buffer): { pieceIdx: number; pieceId: Buffer }[] {
    return this.db.prepare(`
      SELECT pieceIdx, pieceId FROM blob_pieces
      WHERE root = ?
      ORDER BY pieceIdx ASC
    `).all(root) as { pieceIdx: number; pieceId: Buffer }[];
  }

  isBlobComplete(root: Buffer): boolean {
    const row = this.db.prepare(`
      SELECT b.pieceCount AS expected,
             (SELECT COUNT(*) FROM blob_pieces bp WHERE bp.root = b.root) AS have
      FROM blobs b
      WHERE b.root = ?
    `).get(root) as { expected: number; have: number } | undefined;
    return row != null && row.have === row.expected;
  }

  // ─── Garbage collection ────────────────────────────────────────────────

  evictLRUPieces(maxBytesToFree: number): number {
    let freed = 0;
    const orphans = this.db.prepare(`
      SELECT pieceId, size FROM pieces
      WHERE refCount <= 0
      ORDER BY lastAccessedAt ASC
    `).all() as { pieceId: Buffer; size: number }[];
    const del = this.db.prepare('DELETE FROM pieces WHERE pieceId = ?');
    for (const { pieceId, size } of orphans) {
      if (freed >= maxBytesToFree) break;
      del.run(pieceId);
      freed += size;
    }
    return freed;
  }

  /** R25 — Phase 5. Enumerate every piece id we currently hold. Used by
   *  the swarm layer to populate HAVE_ANNOUNCE on peer connect. */
  allPieceIds(): Buffer[] {
    return (this.db.prepare('SELECT pieceId FROM pieces').all() as { pieceId: Buffer }[])
      .map((r) => r.pieceId);
  }

  stats(): { blobCount: number; pieceCount: number; totalBytes: number } {
    const blobs = (this.db.prepare('SELECT COUNT(*) AS n FROM blobs').get() as { n: number }).n;
    const pieces = this.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS b FROM pieces').get() as { n: number; b: number };
    return { blobCount: blobs, pieceCount: pieces.n, totalBytes: pieces.b };
  }
}
