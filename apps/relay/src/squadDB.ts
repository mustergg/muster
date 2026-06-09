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
  /** 1 = community-staff "ghost" member (auto-added for moderation; hidden in
   *  presence, shown with a role badge). 0 = a real squad member. */
  ghost?: number;
}

export interface DBSquadMessage {
  messageId: string;
  squadId: string;
  content: string;
  senderPublicKey: string;
  senderUsername: string;
  timestamp: number;
  /** 'text' (main chat) or 'voice' (voice channel's dedicated text chat). */
  room?: string;
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
      ghost           INTEGER NOT NULL DEFAULT 0,
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
      timestamp       INTEGER NOT NULL,
      room            TEXT NOT NULL DEFAULT 'text'
    );

    CREATE INDEX IF NOT EXISTS idx_squad_msgs ON squad_messages (squadId, timestamp);
  `);

  // Migration: add the `ghost` column to pre-existing squad_members tables.
  const mcols = db.prepare(`PRAGMA table_info(squad_members)`).all() as Array<{ name: string }>;
  if (!mcols.some((c) => c.name === 'ghost')) {
    db.exec(`ALTER TABLE squad_members ADD COLUMN ghost INTEGER NOT NULL DEFAULT 0`);
  }

  // Migration: add the `room` column to pre-existing squad_messages tables.
  const cols = db.prepare(`PRAGMA table_info(squad_messages)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'room')) {
    db.exec(`ALTER TABLE squad_messages ADD COLUMN room TEXT NOT NULL DEFAULT 'text'`);
  }
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

  /** Reparent a squad to a new community (used to detach a community squad into
   *  the owner's personal space: `personal:<ownerPublicKey>`). */
  setCommunityId(squadId: string, communityId: string): void {
    this.db.prepare('UPDATE squads SET communityId = ? WHERE id = ?').run(communityId, squadId);
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

  addMember(squadId: string, publicKey: string, username: string, role = 'member', ghost = false): boolean {
    try {
      this.db.prepare(`
        INSERT INTO squad_members (squadId, publicKey, username, role, joinedAt, ghost)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(squadId, publicKey, username, role, Date.now(), ghost ? 1 : 0);
      return true;
    } catch {
      return false; // already a member
    }
  }

  /** Ensure each community-staff entry is a ghost member of the squad. Real
   *  members (ghost=0) are left untouched. Returns the members that were newly
   *  added as ghosts (so the caller can announce them for key distribution). */
  ensureGhostStaff(squadId: string, staff: Array<{ publicKey: string; username: string; role: string }>): DBSquadMember[] {
    const added: DBSquadMember[] = [];
    for (const s of staff) {
      const existing = this.getMember(squadId, s.publicKey);
      if (existing) continue; // already a member (real or ghost)
      const ok = this.addMember(squadId, s.publicKey, s.username, s.role, true);
      if (ok) added.push({ squadId, publicKey: s.publicKey, username: s.username, role: s.role, joinedAt: Date.now(), ghost: 1 });
    }
    return added;
  }

  /** Remove all ghost (community-staff) members from a squad — used on detach. */
  removeGhosts(squadId: string): number {
    return this.db.prepare('DELETE FROM squad_members WHERE squadId = ? AND ghost = 1').run(squadId).changes;
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
      INSERT OR IGNORE INTO squad_messages (messageId, squadId, content, senderPublicKey, senderUsername, timestamp, room)
      VALUES (@messageId, @squadId, @content, @senderPublicKey, @senderUsername, @timestamp, @room)
    `).run({ ...msg, room: msg.room || 'text' });
  }

  getMessagesSince(squadId: string, since: number, room = 'text', limit = 200): DBSquadMessage[] {
    return this.db.prepare(
      'SELECT * FROM squad_messages WHERE squadId = ? AND room = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT ?'
    ).all(squadId, room, since, limit) as DBSquadMessage[];
  }

  getSquadCount(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM squads').get() as any).c;
  }
}
