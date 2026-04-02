/**
 * File Database — stores file metadata in SQLite, file data on disk.
 *
 * Files are stored at ~/.muster-relay/files/<fileId>
 * Metadata (filename, mime, size, uploader, channel) in SQLite.
 */

import type Database from 'better-sqlite3';
import { mkdirSync, existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface DBFile {
  fileId: string;
  channel: string;
  fileName: string;
  mimeType: string;
  size: number;
  senderPublicKey: string;
  senderUsername: string;
  timestamp: number;
}

const FILES_DIR = join(homedir(), '.muster-relay', 'files');

export function initFileTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      fileId           TEXT PRIMARY KEY,
      channel          TEXT NOT NULL,
      fileName         TEXT NOT NULL,
      mimeType         TEXT NOT NULL,
      size             INTEGER NOT NULL,
      senderPublicKey  TEXT NOT NULL,
      senderUsername   TEXT NOT NULL,
      timestamp        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_files_channel ON files (channel);
    CREATE INDEX IF NOT EXISTS idx_files_timestamp ON files (timestamp);
  `);
}

export class FileDB {
  private db: Database.Database;
  private filesDir: string;

  constructor(db: Database.Database) {
    this.db = db;
    this.filesDir = FILES_DIR;
    if (!existsSync(this.filesDir)) mkdirSync(this.filesDir, { recursive: true });
    initFileTables(db);
    console.log(`[relay-db] File tables initialized. Storage: ${this.filesDir}`);
  }

  /** Store file metadata in SQLite and file data on disk. */
  storeFile(meta: DBFile, base64Data: string): void {
    // Write file to disk
    const filePath = join(this.filesDir, meta.fileId);
    const buffer = Buffer.from(base64Data, 'base64');
    writeFileSync(filePath, buffer);

    // Store metadata
    this.db.prepare(`
      INSERT OR IGNORE INTO files (fileId, channel, fileName, mimeType, size, senderPublicKey, senderUsername, timestamp)
      VALUES (@fileId, @channel, @fileName, @mimeType, @size, @senderPublicKey, @senderUsername, @timestamp)
    `).run(meta);
  }

  /** Get file metadata. */
  getFileMeta(fileId: string): DBFile | undefined {
    return this.db.prepare('SELECT * FROM files WHERE fileId = ?').get(fileId) as DBFile | undefined;
  }

  /** Read file data from disk and return as base64. Returns null if file not found. */
  getFileData(fileId: string): string | null {
    const filePath = join(this.filesDir, fileId);
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath).toString('base64');
  }

  /** Delete a file (metadata + disk). */
  deleteFile(fileId: string): void {
    this.db.prepare('DELETE FROM files WHERE fileId = ?').run(fileId);
    const filePath = join(this.filesDir, fileId);
    try { if (existsSync(filePath)) unlinkSync(filePath); } catch { /* ignore */ }
  }

  /** Delete all files for a channel (used in community deletion). */
  deleteFilesByChannel(channel: string): void {
    const files = this.db.prepare('SELECT fileId FROM files WHERE channel = ?').all(channel) as Array<{ fileId: string }>;
    for (const f of files) {
      const filePath = join(this.filesDir, f.fileId);
      try { if (existsSync(filePath)) unlinkSync(filePath); } catch { /* ignore */ }
    }
    this.db.prepare('DELETE FROM files WHERE channel = ?').run(channel);
  }

  /** Delete files older than timestamp. */
  deleteOlderThan(timestamp: number): number {
    const files = this.db.prepare('SELECT fileId FROM files WHERE timestamp < ?').all(timestamp) as Array<{ fileId: string }>;
    for (const f of files) {
      const filePath = join(this.filesDir, f.fileId);
      try { if (existsSync(filePath)) unlinkSync(filePath); } catch { /* ignore */ }
    }
    return this.db.prepare('DELETE FROM files WHERE timestamp < ?').run(timestamp).changes;
  }

  getCount(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM files').get() as any).c;
  }

  getTotalSize(): number {
    return (this.db.prepare('SELECT COALESCE(SUM(size), 0) as s FROM files').get() as any).s;
  }
}
