/**
 * Squad Database — R13
 *
 * Tables:
 *   squads         — squad metadata (name, owner, channels, community)
 *   squad_members  — members of each squad
 *   squad_messages — text chat messages within squads
 */

import type Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

export interface DBSquad {
  id: string;
  communityId: string;
  name: string;
  ownerPublicKey: string;
  ownerUsername: string;
  textChannelId: string;
  voiceChannelId: string;
  createdAt: number;
}

export interface DBSquadMember {
  squadId: string;
  publicKey: string;
  username: string;
  role: string;
  joinedAt: number;
}

export interface DBSquadMessage {
  messageId: string;
  squadId: string;
  content: string;
  senderPublicKey: string;
  senderUsername: string;
  timestamp: number;
}

function initSquadTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS squads (
      id              TEXT PRIMARY KEY,
      communityId     TEXT NOT NULL,
      name            TEXT NOT NULL,
      ownerPublicKey  TEXT NOT NULL,
      ownerUsername    TEXT NOT NULL,
      textChannelId   TEXT NOT NULL,
      voiceChannelId  TEXT NOT NULL,
      createdAt       INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_squads_community ON squads (communityId);

    CREATE TABLE IF NOT EXISTS squad_members (
      squadId         TEXT NOT NULL,
      publicKey       TEXT NOT NULL,
      username        TEXT NOT NULL,
      role            TEXT NOT NULL DEFAULT 'member',
      joinedAt        INTEGER NOT NULL,
      PRIMARY KEY (squadId, publicKey)
    );

    CREATE INDEX IF NOT EXISTS idx_squad_members_squad ON squad_members (squadId);
    CREATE INDEX IF NOT EXISTS idx_squad_members_user ON squad_members (publicKey);

    CREATE TABLE IF NOT EXISTS squad_messages (
      messageId       TEXT PRIMARY KEY,
      squadId         TEXT NOT NULL,
      content         TEXT NOT NULL,
      senderPublicKey TEXT NOT NULL,
      senderUsername  TEXT NOT NULL,
      timestamp       INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_squad_msgs ON squad_messages (squadId, timestamp);
  `);
}

export class SquadDB {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    initSquadTables(db);
    console.log('[relay-db] Squad tables initialized.');
  }

  // =================================================================
  // Squads
  // =================================================================

  createSquad(communityId: string, name: string, ownerKey: string, ownerUser: string): DBSquad {
    const id = randomBytes(16).toString('hex');
    const textChannelId = 'sq-text-' + id;
    const voiceChannelId = 'sq-voice-' + id;
    const now = Date.now();

    const squad: DBSquad = { id, communityId, name, ownerPublicKey: ownerKey, ownerUsername: ownerUser, textChannelId, voiceChannelId, createdAt: now };

    this.db.prepare(`
      INSERT INTO squads (id, communityId, name, ownerPublicKey, ownerUsername, textChannelId, voiceChannelId, createdAt)
      VALUES (@id, @communityId, @name, @ownerPublicKey, @ownerUsername, @textChannelId, @voiceChannelId, @createdAt)
    `).run(squad);

    // Add owner as first member
    this.addMember(id, ownerKey, ownerUser, 'owner');

    console.log(`[squad-db] Squad created: "${name}" by ${ownerUser} in community ${communityId.slice(0, 8)}`);
    return squad;
  }

  getSquad(squadId: string): DBSquad | undefined {
    return this.db.prepare('SELECT * FROM squads WHERE id = ?').get(squadId) as DBSquad | undefined;
  }

  getSquadsForCommunity(communityId: string): Array<DBSquad & { memberCount: number }> {
    const squads = this.db.prepare('SELECT * FROM squads WHERE communityId = ? ORDER BY createdAt ASC').all(communityId) as DBSquad[];
    return squads.map((s) => ({
      ...s,
      memberCount: (this.db.prepare('SELECT COUNT(*) as c FROM squad_members WHERE squadId = ?').get(s.id) as any).c,
    }));
  }

  deleteSquad(squadId: string): boolean {
    this.db.prepare('DELETE FROM squad_members WHERE squadId = ?').run(squadId);
    this.db.prepare('DELETE FROM squad_messages WHERE squadId = ?').run(squadId);
    const result = this.db.prepare('DELETE FROM squads WHERE id = ?').run(squadId);
    if (result.changes > 0) console.log(`[squad-db] Squad deleted: ${squadId}`);
    return result.changes > 0;
  }

  deleteAllForCommunity(communityId: string): number {
    const squads = this.db.prepare('SELECT id FROM squads WHERE communityId = ?').all(communityId) as Array<{ id: string }>;
    for (const s of squads) {
      this.db.prepare('DELETE FROM squad_members WHERE squadId = ?').run(s.id);
      this.db.prepare('DELETE FROM squad_messages WHERE squadId = ?').run(s.id);
    }
    return this.db.prepare('DELETE FROM squads WHERE communityId = ?').run(communityId).changes;
  }

  // =================================================================
  // Members
  // =================================================================

  addMember(squadId: string, publicKey: string, username: string, role = 'member'): boolean {
    try {
      this.db.prepare(`
        INSERT INTO squad_members (squadId, publicKey, username, role, joinedAt)
        VALUES (?, ?, ?, ?, ?)
      `).run(squadId, publicKey, username, role, Date.now());
      return true;
    } catch {
      return false; // already a member
    }
  }

  removeMember(squadId: string, publicKey: string): boolean {
    const result = this.db.prepare('DELETE FROM squad_members WHERE squadId = ? AND publicKey = ?').run(squadId, publicKey);
    return result.changes > 0;
  }

  getMembers(squadId: string): DBSquadMember[] {
    return this.db.prepare('SELECT * FROM squad_members WHERE squadId = ? ORDER BY joinedAt ASC').all(squadId) as DBSquadMember[];
  }

  getMember(squadId: string, publicKey: string): DBSquadMember | undefined {
    return this.db.prepare('SELECT * FROM squad_members WHERE squadId = ? AND publicKey = ?').get(squadId, publicKey) as DBSquadMember | undefined;
  }

  isMember(squadId: string, publicKey: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM squad_members WHERE squadId = ? AND publicKey = ?').get(squadId, publicKey);
  }

  isOwner(squadId: string, publicKey: string): boolean {
    const squad = this.getSquad(squadId);
    return squad?.ownerPublicKey === publicKey;
  }

  getMemberCount(squadId: string): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM squad_members WHERE squadId = ?').get(squadId) as any).c;
  }

  /** Get all squads a user is a member of (within a community). */
  getUserSquads(communityId: string, publicKey: string): string[] {
    const rows = this.db.prepare(`
      SELECT sm.squadId FROM squad_members sm
      JOIN squads s ON s.id = sm.squadId
      WHERE s.communityId = ? AND sm.publicKey = ?
    `).all(communityId, publicKey) as Array<{ squadId: string }>;
    return rows.map((r) => r.squadId);
  }

  // =================================================================
  // Messages
  // =================================================================

  storeMessage(msg: DBSquadMessage): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO squad_messages (messageId, squadId, content, senderPublicKey, senderUsername, timestamp)
      VALUES (@messageId, @squadId, @content, @senderPublicKey, @senderUsername, @timestamp)
    `).run(msg);
  }

  getMessagesSince(squadId: string, since: number, limit = 200): DBSquadMessage[] {
    return this.db.prepare(
      'SELECT * FROM squad_messages WHERE squadId = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT ?'
    ).all(squadId, since, limit) as DBSquadMessage[];
  }

  getSquadCount(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM squads').get() as any).c;
  }
}
