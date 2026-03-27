/**
 * Relay Database — R3 update
 *
 * Changes from R2:
 * - Exposes the internal SQLite database instance via getDB()
 *   so CommunityDB can share the same database file.
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface RelayDBMessage {
  messageId: string;
  channel: string;
  content: string;
  senderPublicKey: string;
  senderUsername: string;
  timestamp: number;
  signature: string;
}

export class RelayDB {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const dir = dbPath
      ? dbPath.substring(0, dbPath.lastIndexOf('/'))
      : join(homedir(), '.muster-relay');

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const fullPath = dbPath || join(dir, 'relay.db');
    this.db = new Database(fullPath);
    this.db.pragma('journal_mode = WAL');
    this.createTables();
    console.log(`[relay-db] Database opened at ${fullPath}`);
  }

  /** Expose the internal database instance for shared use (e.g. CommunityDB). */
  getDB(): Database.Database {
    return this.db;
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        messageId      TEXT PRIMARY KEY,
        channel        TEXT NOT NULL,
        content        TEXT NOT NULL,
        senderPublicKey TEXT NOT NULL,
        senderUsername  TEXT NOT NULL,
        timestamp      INTEGER NOT NULL,
        signature      TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_channel_ts
        ON messages (channel, timestamp);

      CREATE INDEX IF NOT EXISTS idx_messages_timestamp
        ON messages (timestamp);
    `);
  }

  storeMessage(msg: RelayDBMessage): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO messages
        (messageId, channel, content, senderPublicKey, senderUsername, timestamp, signature)
      VALUES
        (@messageId, @channel, @content, @senderPublicKey, @senderUsername, @timestamp, @signature)
    `);
    stmt.run(msg);
  }

  getMessagesSince(channel: string, since: number, limit = 500): RelayDBMessage[] {
    const stmt = this.db.prepare(`
      SELECT messageId, channel, content, senderPublicKey, senderUsername, timestamp, signature
      FROM messages
      WHERE channel = ? AND timestamp > ?
      ORDER BY timestamp ASC
      LIMIT ?
    `);
    return stmt.all(channel, since, limit) as RelayDBMessage[];
  }

  getMessageCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM messages');
    return (stmt.get() as any).count;
  }

  getChannelStats(): Array<{ channel: string; count: number; latest: number }> {
    const stmt = this.db.prepare(`
      SELECT channel, COUNT(*) as count, MAX(timestamp) as latest
      FROM messages GROUP BY channel ORDER BY latest DESC
    `);
    return stmt.all() as any[];
  }

  deleteOlderThan(timestamp: number): number {
    const stmt = this.db.prepare('DELETE FROM messages WHERE timestamp < ?');
    return stmt.run(timestamp).changes;
  }

  close(): void {
    this.db.close();
    console.log('[relay-db] Database closed.');
  }
}
