/**
 * DM Database — R5b fix
 *
 * Fixes:
 * - getConversations() now properly resolves partner username
 * - Uses two separate queries to get the correct other-user info
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

  // Add recipientUsername column if not exists (migration for existing DBs)
  try {
    db.exec(`ALTER TABLE direct_messages ADD COLUMN recipientUsername TEXT NOT NULL DEFAULT ''`);
  } catch {
    // Column already exists — ignore
  }
}

export class DMDB {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    initDMTables(db);
    console.log('[relay-db] DM tables initialized.');
  }

  storeMessage(msg: DBDirectMessage & { recipientUsername?: string }): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO direct_messages
        (messageId, senderPublicKey, senderUsername, recipientPublicKey, recipientUsername, content, timestamp, signature)
      VALUES
        (@messageId, @senderPublicKey, @senderUsername, @recipientPublicKey, @recipientUsername, @content, @timestamp, @signature)
    `).run({
      ...msg,
      recipientUsername: msg.recipientUsername || '',
    });
  }

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
   * Get DM conversations for a user — properly resolves partner username.
   */
  getConversations(publicKey: string): Array<{
    publicKey: string;
    username: string;
    lastMessage: string;
    lastTimestamp: number;
  }> {
    // Step 1: Get all unique conversation partners
    const sent = this.db.prepare(`
      SELECT DISTINCT recipientPublicKey as partnerKey, recipientUsername as partnerName
      FROM direct_messages WHERE senderPublicKey = ? AND recipientUsername != ''
    `).all(publicKey) as any[];

    const received = this.db.prepare(`
      SELECT DISTINCT senderPublicKey as partnerKey, senderUsername as partnerName
      FROM direct_messages WHERE recipientPublicKey = ?
    `).all(publicKey) as any[];

    // Build a map of partner publicKey → username
    const partnerMap = new Map<string, string>();
    for (const r of received) partnerMap.set(r.partnerKey, r.partnerName);
    for (const s of sent) {
      if (s.partnerName) partnerMap.set(s.partnerKey, s.partnerName);
    }

    // Step 2: For each partner, get the latest message
    const conversations: Array<{ publicKey: string; username: string; lastMessage: string; lastTimestamp: number }> = [];

    for (const [partnerKey, partnerUsername] of partnerMap) {
      const latest = this.db.prepare(`
        SELECT content, timestamp FROM direct_messages
        WHERE (senderPublicKey = ? AND recipientPublicKey = ?)
           OR (senderPublicKey = ? AND recipientPublicKey = ?)
        ORDER BY timestamp DESC LIMIT 1
      `).get(publicKey, partnerKey, partnerKey, publicKey) as any;

      if (latest) {
        conversations.push({
          publicKey: partnerKey,
          username: partnerUsername || partnerKey.slice(0, 8) + '...',
          lastMessage: (latest.content || '').slice(0, 100),
          lastTimestamp: latest.timestamp,
        });
      }
    }

    // Sort by most recent
    conversations.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
    return conversations;
  }

  getCount(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM direct_messages').get() as any).c;
  }
}
