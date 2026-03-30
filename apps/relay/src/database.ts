/**
 * Relay Database — R4 update
 * Changes: Added deleteMessage() for moderation.
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
    const dir = dbPath ? dbPath.substring(0, dbPath.lastIndexOf('/')) : join(homedir(), '.muster-relay');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const fullPath = dbPath || join(dir, 'relay.db');
    this.db = new Database(fullPath);
    this.db.pragma('journal_mode = WAL');
    this.createTables();
    console.log(`[relay-db] Database opened at ${fullPath}`);
  }

  getDatabase(): Database.Database { return this.db; }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        messageId TEXT PRIMARY KEY, channel TEXT NOT NULL, content TEXT NOT NULL,
        senderPublicKey TEXT NOT NULL, senderUsername TEXT NOT NULL,
        timestamp INTEGER NOT NULL, signature TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_channel_ts ON messages (channel, timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp);
    `);
  }

  storeMessage(msg: RelayDBMessage): void {
    this.db.prepare(`INSERT OR IGNORE INTO messages (messageId, channel, content, senderPublicKey, senderUsername, timestamp, signature) VALUES (@messageId, @channel, @content, @senderPublicKey, @senderUsername, @timestamp, @signature)`).run(msg);
  }

  getMessagesSince(channel: string, since: number, limit = 500): RelayDBMessage[] {
    return this.db.prepare(`SELECT * FROM messages WHERE channel = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT ?`).all(channel, since, limit) as RelayDBMessage[];
  }

  getMessageCount(): number {
    return (this.db.prepare('SELECT COUNT(*) as count FROM messages').get() as any).count;
  }

  /** Delete a specific message by ID (moderation). */
  deleteMessage(messageId: string): void {
    this.db.prepare('DELETE FROM messages WHERE messageId = ?').run(messageId);
  }

  deleteOlderThan(timestamp: number): number {
    return this.db.prepare('DELETE FROM messages WHERE timestamp < ?').run(timestamp).changes;
  }

  close(): void {
    this.db.close();
    console.log('[relay-db] Database closed.');
  }
}
