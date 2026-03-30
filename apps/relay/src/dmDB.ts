/**
 * DM Database — SQLite tables for direct messages.
 */

import type Database from 'better-sqlite3';

export interface DBDirectMessage {
  messageId: string;
  senderPublicKey: string;
  senderUsername: string;
  recipientPublicKey: string;
  content: string;
  timestamp: number;
  signature: string;
}

export function initDMTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS direct_messages (
      messageId          TEXT PRIMARY KEY,
      senderPublicKey    TEXT NOT NULL,
      senderUsername     TEXT NOT NULL,
      recipientPublicKey TEXT NOT NULL,
      content            TEXT NOT NULL,
      timestamp          INTEGER NOT NULL,
      signature          TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_dm_participants
      ON direct_messages (senderPublicKey, recipientPublicKey, timestamp);

    CREATE INDEX IF NOT EXISTS idx_dm_recipient
      ON direct_messages (recipientPublicKey, timestamp);
  `);
}

export class DMDB {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    initDMTables(db);
    console.log('[relay-db] DM tables initialized.');
  }

  /** Store a DM. */
  storeMessage(msg: DBDirectMessage): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO direct_messages
        (messageId, senderPublicKey, senderUsername, recipientPublicKey, content, timestamp, signature)
      VALUES
        (@messageId, @senderPublicKey, @senderUsername, @recipientPublicKey, @content, @timestamp, @signature)
    `).run(msg);
  }

  /**
   * Get DM history between two users since a timestamp.
   * Returns messages in both directions, sorted by time.
   */
  getHistory(userA: string, userB: string, since: number, limit = 200): DBDirectMessage[] {
    return this.db.prepare(`
      SELECT * FROM direct_messages
      WHERE timestamp > ?
        AND (
          (senderPublicKey = ? AND recipientPublicKey = ?)
          OR (senderPublicKey = ? AND recipientPublicKey = ?)
        )
      ORDER BY timestamp ASC
      LIMIT ?
    `).all(since, userA, userB, userB, userA, limit) as DBDirectMessage[];
  }

  /**
   * Get list of DM conversations for a user.
   * Returns the latest message per conversation partner.
   */
  getConversations(publicKey: string): Array<{
    publicKey: string;
    username: string;
    lastMessage: string;
    lastTimestamp: number;
  }> {
    // Get the latest message for each conversation partner
    const rows = this.db.prepare(`
      SELECT
        CASE
          WHEN senderPublicKey = ? THEN recipientPublicKey
          ELSE senderPublicKey
        END as otherKey,
        CASE
          WHEN senderPublicKey = ? THEN ''
          ELSE senderUsername
        END as otherUsername,
        content as lastMessage,
        MAX(timestamp) as lastTimestamp
      FROM direct_messages
      WHERE senderPublicKey = ? OR recipientPublicKey = ?
      GROUP BY otherKey
      ORDER BY lastTimestamp DESC
    `).all(publicKey, publicKey, publicKey, publicKey) as any[];

    // Resolve usernames for cases where we sent the last message
    return rows.map((r) => ({
      publicKey: r.otherKey,
      username: r.otherUsername || r.otherKey.slice(0, 8) + '...',
      lastMessage: r.lastMessage.slice(0, 100),
      lastTimestamp: r.lastTimestamp,
    }));
  }

  /** Get total DM count. */
  getCount(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM direct_messages').get() as any).c;
  }
}
