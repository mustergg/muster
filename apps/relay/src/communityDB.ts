/**
 * Community Database — R8 update
 *
 * Changes from R7:
 * - Added transferOwnership() — changes owner in communities table + swaps roles in members
 * - Added deleteCommunityFull() — deletes community + channels + members (CASCADE)
 */

import type Database from 'better-sqlite3';

export interface DBCommunity {
  id: string;
  name: string;
  description: string;
  type: string;
  ownerPublicKey: string;
  createdAt: number;
}

export interface DBChannel {
  id: string;
  communityId: string;
  name: string;
  type: string;
  visibility: string;
  position: number;
}

export interface DBMember {
  communityId: string;
  publicKey: string;
  username: string;
  role: string;
  joinedAt: number;
}

export function initCommunityTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS communities (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      type            TEXT NOT NULL DEFAULT 'public',
      ownerPublicKey  TEXT NOT NULL,
      createdAt       INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channels (
      id              TEXT PRIMARY KEY,
      communityId     TEXT NOT NULL,
      name            TEXT NOT NULL,
      type            TEXT NOT NULL DEFAULT 'text',
      visibility      TEXT NOT NULL DEFAULT 'public',
      position        INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (communityId) REFERENCES communities(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_channels_community
      ON channels (communityId);

    CREATE TABLE IF NOT EXISTS members (
      communityId     TEXT NOT NULL,
      publicKey       TEXT NOT NULL,
      username        TEXT NOT NULL,
      role            TEXT NOT NULL DEFAULT 'member',
      joinedAt        INTEGER NOT NULL,
      PRIMARY KEY (communityId, publicKey),
      FOREIGN KEY (communityId) REFERENCES communities(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_members_community ON members (communityId);
    CREATE INDEX IF NOT EXISTS idx_members_pubkey ON members (publicKey);
  `);
}

export class CommunityDB {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    initCommunityTables(db);
    console.log('[relay-db] Community tables initialized.');
  }

  // =================================================================
  // Communities
  // =================================================================

  createCommunity(community: DBCommunity, defaultChannels: DBChannel[], owner: DBMember): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO communities (id, name, description, type, ownerPublicKey, createdAt) VALUES (@id, @name, @description, @type, @ownerPublicKey, @createdAt)`).run(community);
      const chStmt = this.db.prepare(`INSERT INTO channels (id, communityId, name, type, visibility, position) VALUES (@id, @communityId, @name, @type, @visibility, @position)`);
      for (const ch of defaultChannels) chStmt.run(ch);
      this.db.prepare(`INSERT INTO members (communityId, publicKey, username, role, joinedAt) VALUES (@communityId, @publicKey, @username, @role, @joinedAt)`).run(owner);
    });
    transaction();
  }

  getCommunity(id: string): DBCommunity | undefined {
    return this.db.prepare('SELECT * FROM communities WHERE id = ?').get(id) as DBCommunity | undefined;
  }

  // =================================================================
  // Channels
  // =================================================================

  getChannels(communityId: string): DBChannel[] {
    return this.db.prepare('SELECT * FROM channels WHERE communityId = ? ORDER BY position').all(communityId) as DBChannel[];
  }

  addChannel(channel: DBChannel): void {
    this.db.prepare(
      `INSERT INTO channels (id, communityId, name, type, visibility, position) VALUES (@id, @communityId, @name, @type, @visibility, @position)`
    ).run(channel);
  }

  updateChannel(channelId: string, name: string, visibility: string): void {
    this.db.prepare('UPDATE channels SET name = ?, visibility = ? WHERE id = ?').run(name, visibility, channelId);
  }

  deleteChannel(channelId: string): void {
    this.db.prepare('DELETE FROM channels WHERE id = ?').run(channelId);
  }

  reorderChannels(communityId: string, channelIds: string[]): void {
    const stmt = this.db.prepare('UPDATE channels SET position = ? WHERE id = ? AND communityId = ?');
    const transaction = this.db.transaction(() => {
      for (let i = 0; i < channelIds.length; i++) {
        stmt.run(i, channelIds[i], communityId);
      }
    });
    transaction();
  }

  // =================================================================
  // Members
  // =================================================================

  getMembers(communityId: string): DBMember[] {
    return this.db.prepare('SELECT * FROM members WHERE communityId = ? ORDER BY joinedAt').all(communityId) as DBMember[];
  }

  getMemberCount(communityId: string): number {
    return (this.db.prepare('SELECT COUNT(*) as count FROM members WHERE communityId = ?').get(communityId) as any)?.count ?? 0;
  }

  isMember(communityId: string, publicKey: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM members WHERE communityId = ? AND publicKey = ?').get(communityId, publicKey);
  }

  addMember(member: DBMember): void {
    this.db.prepare(`INSERT OR IGNORE INTO members (communityId, publicKey, username, role, joinedAt) VALUES (@communityId, @publicKey, @username, @role, @joinedAt)`).run(member);
  }

  removeMember(communityId: string, publicKey: string): void {
    this.db.prepare('DELETE FROM members WHERE communityId = ? AND publicKey = ?').run(communityId, publicKey);
  }

  updateMemberRole(communityId: string, publicKey: string, newRole: string): void {
    this.db.prepare('UPDATE members SET role = ? WHERE communityId = ? AND publicKey = ?').run(newRole, communityId, publicKey);
  }

  getMemberRole(communityId: string, publicKey: string): string | null {
    const row = this.db.prepare('SELECT role FROM members WHERE communityId = ? AND publicKey = ?').get(communityId, publicKey) as any;
    return row?.role ?? null;
  }

  getCommunitiesForUser(publicKey: string): Array<DBCommunity & { memberCount: number }> {
    return this.db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM members m2 WHERE m2.communityId = c.id) as memberCount
      FROM communities c JOIN members m ON m.communityId = c.id
      WHERE m.publicKey = ? ORDER BY c.createdAt DESC
    `).all(publicKey) as any[];
  }

  getCommunityCount(): number {
    return (this.db.prepare('SELECT COUNT(*) as count FROM communities').get() as any)?.count ?? 0;
  }

  // =================================================================
  // Ownership Transfer — R8
  // =================================================================

  /**
   * Transfer ownership of a community to a new member.
   * - Updates ownerPublicKey in communities table
   * - Sets new owner's role to 'owner'
   * - Demotes previous owner to 'admin'
   */
  transferOwnership(communityId: string, oldOwnerPublicKey: string, newOwnerPublicKey: string): void {
    const transaction = this.db.transaction(() => {
      // Update the community's owner
      this.db.prepare(
        'UPDATE communities SET ownerPublicKey = ? WHERE id = ?'
      ).run(newOwnerPublicKey, communityId);

      // Set new owner's role to 'owner'
      this.db.prepare(
        'UPDATE members SET role = ? WHERE communityId = ? AND publicKey = ?'
      ).run('owner', communityId, newOwnerPublicKey);

      // Demote old owner to 'admin'
      this.db.prepare(
        'UPDATE members SET role = ? WHERE communityId = ? AND publicKey = ?'
      ).run('admin', communityId, oldOwnerPublicKey);
    });
    transaction();
  }

  // =================================================================
  // Delete Community — R8
  // =================================================================

  /**
   * Fully delete a community and all related data.
   * Channels and members are deleted via CASCADE.
   */
  deleteCommunityFull(communityId: string): void {
    const transaction = this.db.transaction(() => {
      // Delete members explicitly (in case CASCADE isn't enabled)
      this.db.prepare('DELETE FROM members WHERE communityId = ?').run(communityId);
      // Delete channels
      this.db.prepare('DELETE FROM channels WHERE communityId = ?').run(communityId);
      // Delete the community
      this.db.prepare('DELETE FROM communities WHERE id = ?').run(communityId);
    });
    transaction();
  }
}
