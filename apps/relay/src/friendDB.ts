/**
 * Friend Database — R11
 *
 * Tables:
 *   friend_requests — pending/accepted/declined requests
 *   friends         — mutual friendships (denormalized for fast lookup)
 *   blocked_users   — per-user block list
 */

import type Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

export interface DBFriendRequest {
  id: string;
  fromPublicKey: string;
  fromUsername: string;
  toPublicKey: string;
  toUsername: string;
  status: string;         // pending | accepted | declined
  createdAt: number;
}

export interface DBFriend {
  userA: string;
  userB: string;
  usernameA: string;
  usernameB: string;
  displayNameA: string;
  displayNameB: string;
  since: number;
}

export interface DBBlock {
  blockerPublicKey: string;
  blockedPublicKey: string;
  blockedUsername: string;
  blockedAt: number;
}

function initFriendTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id              TEXT PRIMARY KEY,
      fromPublicKey   TEXT NOT NULL,
      fromUsername     TEXT NOT NULL,
      toPublicKey     TEXT NOT NULL,
      toUsername       TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      createdAt       INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_fr_from ON friend_requests (fromPublicKey);
    CREATE INDEX IF NOT EXISTS idx_fr_to ON friend_requests (toPublicKey);
    CREATE INDEX IF NOT EXISTS idx_fr_status ON friend_requests (status);

    CREATE TABLE IF NOT EXISTS friends (
      userA           TEXT NOT NULL,
      userB           TEXT NOT NULL,
      usernameA       TEXT NOT NULL,
      usernameB       TEXT NOT NULL,
      displayNameA    TEXT NOT NULL DEFAULT '',
      displayNameB    TEXT NOT NULL DEFAULT '',
      since           INTEGER NOT NULL,
      PRIMARY KEY (userA, userB)
    );

    CREATE INDEX IF NOT EXISTS idx_friends_a ON friends (userA);
    CREATE INDEX IF NOT EXISTS idx_friends_b ON friends (userB);

    CREATE TABLE IF NOT EXISTS blocked_users (
      blockerPublicKey  TEXT NOT NULL,
      blockedPublicKey  TEXT NOT NULL,
      blockedUsername    TEXT NOT NULL DEFAULT '',
      blockedAt         INTEGER NOT NULL,
      PRIMARY KEY (blockerPublicKey, blockedPublicKey)
    );

    CREATE INDEX IF NOT EXISTS idx_blocked ON blocked_users (blockerPublicKey);
  `);
}

export class FriendDB {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    initFriendTables(db);
    this.cleanupExpiredRequests();
    console.log('[relay-db] Friend tables initialized.');
  }

  // =================================================================
  // Friend Requests
  // =================================================================

  sendRequest(fromKey: string, fromUser: string, toKey: string, toUser: string): { request?: DBFriendRequest; error?: string } {
    // Cannot friend yourself
    if (fromKey === toKey) return { error: 'You cannot send a friend request to yourself.' };

    // Check if blocked by target
    const blocked = this.db.prepare(
      'SELECT 1 FROM blocked_users WHERE blockerPublicKey = ? AND blockedPublicKey = ?'
    ).get(toKey, fromKey);
    if (blocked) return { error: 'Cannot send friend request to this user.' };

    // Check if already friends
    if (this.areFriends(fromKey, toKey)) return { error: 'You are already friends with this user.' };

    // Check for existing pending request in either direction
    const existing = this.db.prepare(
      `SELECT id, status FROM friend_requests
       WHERE ((fromPublicKey = ? AND toPublicKey = ?) OR (fromPublicKey = ? AND toPublicKey = ?))
       AND status = 'pending'`
    ).get(fromKey, toKey, toKey, fromKey) as any;
    if (existing) return { error: 'A pending friend request already exists.' };

    const id = randomBytes(16).toString('hex');
    const now = Date.now();
    const request: DBFriendRequest = { id, fromPublicKey: fromKey, fromUsername: fromUser, toPublicKey: toKey, toUsername: toUser, status: 'pending', createdAt: now };

    this.db.prepare(`
      INSERT INTO friend_requests (id, fromPublicKey, fromUsername, toPublicKey, toUsername, status, createdAt)
      VALUES (@id, @fromPublicKey, @fromUsername, @toPublicKey, @toUsername, @status, @createdAt)
    `).run(request);

    console.log(`[friend-db] Request sent: ${fromUser} → ${toUser}`);
    return { request };
  }

  respondToRequest(requestId: string, responderKey: string, action: 'accept' | 'decline' | 'block'): { success: boolean; request?: DBFriendRequest; error?: string } {
    const request = this.db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(requestId) as DBFriendRequest | undefined;
    if (!request) return { success: false, error: 'Friend request not found.' };
    if (request.toPublicKey !== responderKey) return { success: false, error: 'You cannot respond to this request.' };
    if (request.status !== 'pending') return { success: false, error: 'This request has already been handled.' };

    if (action === 'accept') {
      this.db.prepare("UPDATE friend_requests SET status = 'accepted' WHERE id = ?").run(requestId);
      this.addFriend(request.fromPublicKey, request.fromUsername, request.toPublicKey, request.toUsername);
      console.log(`[friend-db] Request accepted: ${request.fromUsername} ↔ ${request.toUsername}`);
    } else if (action === 'decline') {
      this.db.prepare("UPDATE friend_requests SET status = 'declined' WHERE id = ?").run(requestId);
      console.log(`[friend-db] Request declined: ${request.toUsername} declined ${request.fromUsername}`);
    } else if (action === 'block') {
      this.db.prepare("UPDATE friend_requests SET status = 'declined' WHERE id = ?").run(requestId);
      this.blockUser(request.toPublicKey, request.fromPublicKey, request.fromUsername);
      console.log(`[friend-db] Request blocked: ${request.toUsername} blocked ${request.fromUsername}`);
    }

    return { success: true, request: { ...request, status: action === 'block' ? 'declined' : action === 'accept' ? 'accepted' : 'declined' } };
  }

  getIncomingRequests(publicKey: string): DBFriendRequest[] {
    return this.db.prepare(
      "SELECT * FROM friend_requests WHERE toPublicKey = ? AND status = 'pending' ORDER BY createdAt DESC"
    ).all(publicKey) as DBFriendRequest[];
  }

  getOutgoingRequests(publicKey: string): DBFriendRequest[] {
    return this.db.prepare(
      "SELECT * FROM friend_requests WHERE fromPublicKey = ? AND status = 'pending' ORDER BY createdAt DESC"
    ).all(publicKey) as DBFriendRequest[];
  }

  // =================================================================
  // Friends
  // =================================================================

  private addFriend(keyA: string, userA: string, keyB: string, userB: string): void {
    const [sortedA, sortedB] = keyA < keyB ? [keyA, keyB] : [keyB, keyA];
    const [nameA, nameB] = keyA < keyB ? [userA, userB] : [userB, userA];
    const now = Date.now();

    this.db.prepare(`
      INSERT OR IGNORE INTO friends (userA, userB, usernameA, usernameB, displayNameA, displayNameB, since)
      VALUES (?, ?, ?, ?, '', '', ?)
    `).run(sortedA, sortedB, nameA, nameB, now);
  }

  areFriends(keyA: string, keyB: string): boolean {
    const [a, b] = keyA < keyB ? [keyA, keyB] : [keyB, keyA];
    return !!this.db.prepare('SELECT 1 FROM friends WHERE userA = ? AND userB = ?').get(a, b);
  }

  getFriends(publicKey: string): Array<{ publicKey: string; username: string; displayName: string; since: number }> {
    const asA = this.db.prepare('SELECT userB as publicKey, usernameB as username, displayNameB as displayName, since FROM friends WHERE userA = ?').all(publicKey) as any[];
    const asB = this.db.prepare('SELECT userA as publicKey, usernameA as username, displayNameA as displayName, since FROM friends WHERE userB = ?').all(publicKey) as any[];
    return [...asA, ...asB].sort((a, b) => a.username.localeCompare(b.username));
  }

  removeFriend(keyA: string, keyB: string): boolean {
    const [a, b] = keyA < keyB ? [keyA, keyB] : [keyB, keyA];
    const result = this.db.prepare('DELETE FROM friends WHERE userA = ? AND userB = ?').run(a, b);
    if (result.changes > 0) console.log(`[friend-db] Friendship removed: ${a.slice(0, 12)}... ↔ ${b.slice(0, 12)}...`);
    return result.changes > 0;
  }

  getFriendCount(publicKey: string): number {
    const a = (this.db.prepare('SELECT COUNT(*) as c FROM friends WHERE userA = ?').get(publicKey) as any).c;
    const b = (this.db.prepare('SELECT COUNT(*) as c FROM friends WHERE userB = ?').get(publicKey) as any).c;
    return a + b;
  }

  // =================================================================
  // Block
  // =================================================================

  blockUser(blockerKey: string, blockedKey: string, blockedUsername: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO blocked_users (blockerPublicKey, blockedPublicKey, blockedUsername, blockedAt)
      VALUES (?, ?, ?, ?)
    `).run(blockerKey, blockedKey, blockedUsername, Date.now());

    // Remove friendship if exists
    this.removeFriend(blockerKey, blockedKey);

    // Cancel any pending requests between them
    this.db.prepare(`
      UPDATE friend_requests SET status = 'declined'
      WHERE status = 'pending'
      AND ((fromPublicKey = ? AND toPublicKey = ?) OR (fromPublicKey = ? AND toPublicKey = ?))
    `).run(blockerKey, blockedKey, blockedKey, blockerKey);

    console.log(`[friend-db] User blocked: ${blockerKey.slice(0, 12)}... blocked ${blockedKey.slice(0, 12)}...`);
  }

  unblockUser(blockerKey: string, blockedKey: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM blocked_users WHERE blockerPublicKey = ? AND blockedPublicKey = ?'
    ).run(blockerKey, blockedKey);
    return result.changes > 0;
  }

  isBlocked(blockerKey: string, blockedKey: string): boolean {
    return !!this.db.prepare(
      'SELECT 1 FROM blocked_users WHERE blockerPublicKey = ? AND blockedPublicKey = ?'
    ).get(blockerKey, blockedKey);
  }

  getBlockedUsers(blockerKey: string): DBBlock[] {
    return this.db.prepare(
      'SELECT * FROM blocked_users WHERE blockerPublicKey = ? ORDER BY blockedAt DESC'
    ).all(blockerKey) as DBBlock[];
  }

  // =================================================================
  // Cleanup
  // =================================================================

  /** Remove pending requests older than 30 days. */
  cleanupExpiredRequests(): number {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(
      "DELETE FROM friend_requests WHERE status = 'pending' AND createdAt < ?"
    ).run(cutoff);
    if (result.changes > 0) console.log(`[friend-db] Cleaned up ${result.changes} expired friend requests.`);
    return result.changes;
  }

  /** Lookup user by username. Returns publicKey or null. */
  findUserByUsername(username: string): { publicKey: string; username: string } | null {
    const user = this.db.prepare('SELECT publicKey, username FROM users WHERE LOWER(username) = LOWER(?)').get(username) as any;
    return user || null;
  }
}
