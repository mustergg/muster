/**
 * Community Database — SQLite tables for communities and members.
 *
 * This file adds community storage to the relay's database.
 * It is imported by the main relay index.ts alongside the message database.
 *
 * Tables:
 * - communities: id, name, description, type, owner, channels (JSON), createdAt
 * - community_members: communityId + publicKey composite key, role, username, joinedAt
 */

import Database from 'better-sqlite3';

export interface DBCommunity {
  id: string;
  name: string;
  description: string;
  type: string;
  ownerPublicKey: string;
  ownerUsername: string;
  channelsJson: string;   // JSON array of StoredChannel
  createdAt: number;
}

export interface DBCommunityMember {
  communityId: string;
  publicKey: string;
  username: string;
  role: string;
  joinedAt: number;
}

export class CommunityDB {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS communities (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        description     TEXT DEFAULT '',
        type            TEXT DEFAULT 'public',
        ownerPublicKey  TEXT NOT NULL,
        ownerUsername   TEXT NOT NULL,
        channelsJson    TEXT NOT NULL DEFAULT '[]',
        createdAt       INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS community_members (
        communityId     TEXT NOT NULL,
        publicKey       TEXT NOT NULL,
        username        TEXT NOT NULL,
        role            TEXT NOT NULL DEFAULT 'member',
        joinedAt        INTEGER NOT NULL,
        PRIMARY KEY (communityId, publicKey)
      );

      CREATE INDEX IF NOT EXISTS idx_members_community
        ON community_members (communityId);

      CREATE INDEX IF NOT EXISTS idx_members_pubkey
        ON community_members (publicKey);
    `);
  }

  // =================================================================
  // Communities
  // =================================================================

  createCommunity(community: DBCommunity): void {
    const stmt = this.db.prepare(`
      INSERT INTO communities (id, name, description, type, ownerPublicKey, ownerUsername, channelsJson, createdAt)
      VALUES (@id, @name, @description, @type, @ownerPublicKey, @ownerUsername, @channelsJson, @createdAt)
    `);
    stmt.run(community);
  }

  getCommunity(id: string): DBCommunity | undefined {
    const stmt = this.db.prepare('SELECT * FROM communities WHERE id = ?');
    return stmt.get(id) as DBCommunity | undefined;
  }

  /** Get all communities a user belongs to. */
  getCommunitiesForUser(publicKey: string): DBCommunity[] {
    const stmt = this.db.prepare(`
      SELECT c.* FROM communities c
      INNER JOIN community_members m ON c.id = m.communityId
      WHERE m.publicKey = ?
      ORDER BY c.createdAt DESC
    `);
    return stmt.all(publicKey) as DBCommunity[];
  }

  // =================================================================
  // Members
  // =================================================================

  addMember(member: DBCommunityMember): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO community_members (communityId, publicKey, username, role, joinedAt)
      VALUES (@communityId, @publicKey, @username, @role, @joinedAt)
    `);
    stmt.run(member);
  }

  removeMember(communityId: string, publicKey: string): void {
    const stmt = this.db.prepare(
      'DELETE FROM community_members WHERE communityId = ? AND publicKey = ?'
    );
    stmt.run(communityId, publicKey);
  }

  getMembers(communityId: string): DBCommunityMember[] {
    const stmt = this.db.prepare(
      'SELECT * FROM community_members WHERE communityId = ? ORDER BY joinedAt ASC'
    );
    return stmt.all(communityId) as DBCommunityMember[];
  }

  getMemberCount(communityId: string): number {
    const stmt = this.db.prepare(
      'SELECT COUNT(*) as count FROM community_members WHERE communityId = ?'
    );
    return (stmt.get(communityId) as any).count;
  }

  isMember(communityId: string, publicKey: string): boolean {
    const stmt = this.db.prepare(
      'SELECT 1 FROM community_members WHERE communityId = ? AND publicKey = ? LIMIT 1'
    );
    return !!stmt.get(communityId, publicKey);
  }
}
