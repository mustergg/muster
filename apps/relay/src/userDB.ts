/**
 * User Database — R10 update
 *
 * Changes from R6:
 * - Added profile columns: displayName, displayNameType, bio, linksJson, avatarFileId
 * - Added updateProfile() and getProfile() methods
 * - Migration: ALTER TABLE adds columns if they don't exist
 */

import type Database from 'better-sqlite3';
import { createHash, randomBytes } from 'crypto';

export interface DBUser {
  publicKey: string;
  username: string;
  tier: 'basic' | 'verified';
  emailHash: string;
  verificationCode: string;
  verificationExpiry: number;
  createdAt: number;
  lastSeen: number;
  // Profile fields (R10)
  displayName: string;
  displayNameType: string;
  bio: string;
  linksJson: string;
  avatarFileId: string;
}

export interface UserProfile {
  publicKey: string;
  username: string;
  displayName: string;
  displayNameType: string;
  bio: string;
  links: string[];
  avatarFileId: string;
  updatedAt: number;
}

export function initUserTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      publicKey          TEXT PRIMARY KEY,
      username           TEXT NOT NULL,
      tier               TEXT NOT NULL DEFAULT 'basic',
      emailHash          TEXT NOT NULL DEFAULT '',
      verificationCode   TEXT NOT NULL DEFAULT '',
      verificationExpiry INTEGER NOT NULL DEFAULT 0,
      createdAt          INTEGER NOT NULL,
      lastSeen           INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_tier ON users (tier);
    CREATE INDEX IF NOT EXISTS idx_users_created ON users (createdAt);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users (emailHash);
  `);

  // R10 migration: add profile columns if they don't exist
  const addCol = (name: string, def: string) => {
    try { db.exec(`ALTER TABLE users ADD COLUMN ${name} ${def}`); }
    catch { /* column already exists */ }
  };
  addCol('displayName', "TEXT NOT NULL DEFAULT ''");
  addCol('displayNameType', "TEXT NOT NULL DEFAULT 'nickname'");
  addCol('bio', "TEXT NOT NULL DEFAULT ''");
  addCol('linksJson', "TEXT NOT NULL DEFAULT '[]'");
  addCol('avatarFileId', "TEXT NOT NULL DEFAULT ''");
}

export class UserDB {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    initUserTables(db);
    console.log('[relay-db] User tables initialized.');
  }

  // =================================================================
  // Registration / Login
  // =================================================================

  ensureUser(publicKey: string, username: string): DBUser {
    const existing = this.getUser(publicKey);
    if (existing) {
      this.db.prepare(
        'UPDATE users SET lastSeen = ?, username = ? WHERE publicKey = ?'
      ).run(Date.now(), username, publicKey);
      return { ...existing, lastSeen: Date.now(), username };
    }

    const now = Date.now();
    const user: Partial<DBUser> = {
      publicKey, username, tier: 'basic',
      emailHash: '', verificationCode: '', verificationExpiry: 0,
      createdAt: now, lastSeen: now,
      displayName: '', displayNameType: 'nickname',
      bio: '', linksJson: '[]', avatarFileId: '',
    };

    this.db.prepare(`
      INSERT INTO users (publicKey, username, tier, emailHash, verificationCode, verificationExpiry, createdAt, lastSeen, displayName, displayNameType, bio, linksJson, avatarFileId)
      VALUES (@publicKey, @username, @tier, @emailHash, @verificationCode, @verificationExpiry, @createdAt, @lastSeen, @displayName, @displayNameType, @bio, @linksJson, @avatarFileId)
    `).run(user);

    console.log(`[user-db] New basic user: ${username} (30-day verify timer + 30-day login grace)`);
    return user as DBUser;
  }

  getUser(publicKey: string): DBUser | undefined {
    return this.db.prepare('SELECT * FROM users WHERE publicKey = ?').get(publicKey) as DBUser | undefined;
  }

  getUserByUsername(username: string): DBUser | undefined {
    return this.db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(username) as DBUser | undefined;
  }

  // =================================================================
  // Profile (R10)
  // =================================================================

  updateProfile(publicKey: string, updates: {
    displayName?: string;
    displayNameType?: string;
    bio?: string;
    links?: string[];
    avatarFileId?: string;
  }): UserProfile | null {
    const user = this.getUser(publicKey);
    if (!user) return null;

    const newDisplayName = updates.displayName ?? user.displayName;
    const newDisplayNameType = updates.displayNameType ?? user.displayNameType;
    const newBio = updates.bio ?? user.bio;
    const newLinksJson = updates.links ? JSON.stringify(updates.links) : user.linksJson;
    const newAvatarFileId = updates.avatarFileId ?? user.avatarFileId;

    this.db.prepare(`
      UPDATE users SET displayName = ?, displayNameType = ?, bio = ?, linksJson = ?, avatarFileId = ?, lastSeen = ?
      WHERE publicKey = ?
    `).run(newDisplayName, newDisplayNameType, newBio, newLinksJson, newAvatarFileId, Date.now(), publicKey);

    return {
      publicKey: user.publicKey,
      username: user.username,
      displayName: newDisplayName,
      displayNameType: newDisplayNameType,
      bio: newBio,
      links: JSON.parse(newLinksJson || '[]'),
      avatarFileId: newAvatarFileId,
      updatedAt: Date.now(),
    };
  }

  getProfile(publicKey: string): UserProfile | null {
    const user = this.getUser(publicKey);
    if (!user) return null;
    return {
      publicKey: user.publicKey,
      username: user.username,
      displayName: user.displayName || '',
      displayNameType: user.displayNameType || 'nickname',
      bio: user.bio || '',
      links: JSON.parse(user.linksJson || '[]'),
      avatarFileId: user.avatarFileId || '',
      updatedAt: user.lastSeen,
    };
  }

  // =================================================================
  // Email verification
  // =================================================================

  static hashEmail(email: string): string {
    return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
  }

  static generateCode(): string {
    return randomBytes(4).toString('hex').toUpperCase();
  }

  registerEmail(publicKey: string, email: string): { code: string; error?: string } {
    const emailHash = UserDB.hashEmail(email);
    const existing = this.db.prepare(
      'SELECT publicKey FROM users WHERE emailHash = ? AND publicKey != ?'
    ).get(emailHash, publicKey) as any;
    if (existing) return { code: '', error: 'This email is already associated with another account.' };

    const code = UserDB.generateCode();
    const expiry = Date.now() + 24 * 60 * 60 * 1000;
    this.db.prepare(
      'UPDATE users SET emailHash = ?, verificationCode = ?, verificationExpiry = ? WHERE publicKey = ?'
    ).run(emailHash, code, expiry, publicKey);
    return { code };
  }

  verifyEmail(publicKey: string, code: string): { success: boolean; error?: string } {
    const user = this.getUser(publicKey);
    if (!user) return { success: false, error: 'User not found' };
    if (user.tier === 'verified') return { success: false, error: 'Already verified' };
    if (!user.verificationCode) return { success: false, error: 'No verification pending' };
    if (Date.now() > user.verificationExpiry) return { success: false, error: 'Verification code expired. Request a new one.' };
    if (user.verificationCode !== code.toUpperCase().trim()) return { success: false, error: 'Invalid verification code' };

    this.db.prepare(
      'UPDATE users SET tier = ?, verificationCode = ?, verificationExpiry = 0 WHERE publicKey = ?'
    ).run('verified', '', publicKey);
    console.log(`[user-db] User verified: ${user.username}`);
    return { success: true };
  }

  // =================================================================
  // Tier queries
  // =================================================================

  getTier(publicKey: string): 'basic' | 'verified' {
    const user = this.getUser(publicKey);
    return user?.tier ?? 'basic';
  }

  isVerified(publicKey: string): boolean {
    return this.getTier(publicKey) === 'verified';
  }

  /**
   * Two-phase lifetime for unverified (basic) accounts:
   *   Phase 1 ("verify"): 30 days from creation to verify the email.
   *   Phase 2 ("grace"):  after that, 30 more days of access that RESET on every
   *                       login. The account is purged 30 days after the later
   *                       of (createdAt + 30d) and the last login.
   * Net: up to ~60 days, but only if the user keeps signing in during phase 2.
   */
  private accountStatus(user: DBUser): { phase: 'verified' | 'verify' | 'grace'; daysRemaining: number; purgeAt: number } {
    if (user.tier === 'verified') return { phase: 'verified', daysRemaining: 0, purgeAt: 0 };
    const DAY = 24 * 60 * 60 * 1000;
    const THIRTY = 30 * DAY;
    const now = Date.now();
    const phase1End = user.createdAt + THIRTY;
    const purgeAt = Math.max(phase1End, user.lastSeen) + THIRTY;
    if (now < phase1End) {
      return { phase: 'verify', daysRemaining: Math.max(0, Math.ceil((phase1End - now) / DAY)), purgeAt };
    }
    return { phase: 'grace', daysRemaining: Math.max(0, Math.ceil((purgeAt - now) / DAY)), purgeAt };
  }

  getDaysRemaining(publicKey: string): number {
    const user = this.getUser(publicKey);
    if (!user) return 0;
    return this.accountStatus(user).daysRemaining;
  }

  getAccountInfo(publicKey: string): {
    publicKey: string; username: string; tier: string;
    emailVerified: boolean; createdAt: number; daysRemaining: number;
    phase: 'verified' | 'verify' | 'grace'; purgeAt: number;
  } {
    const user = this.getUser(publicKey);
    if (!user) return { publicKey, username: '', tier: 'basic', emailVerified: false, createdAt: 0, daysRemaining: 30, phase: 'verify', purgeAt: 0 };
    const st = this.accountStatus(user);
    return {
      publicKey: user.publicKey, username: user.username, tier: user.tier,
      emailVerified: user.tier === 'verified', createdAt: user.createdAt,
      daysRemaining: st.daysRemaining, phase: st.phase, purgeAt: st.purgeAt,
    };
  }

  // =================================================================
  // Cleanup
  // =================================================================

  deleteExpiredAccounts(): number {
    // Purge an unverified account only once BOTH phases are exhausted:
    //   purgeAt = max(createdAt + 30d, lastSeen) + 30d  <=  now
    // i.e. 30 days to verify, then a 30-day grace window that the user resets by
    // logging in (lastSeen). No login in that final window → purged.
    const THIRTY = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const expired = this.db.prepare(
      "SELECT publicKey, username FROM users WHERE tier = 'basic' AND (MAX(createdAt + ?, lastSeen) + ?) <= ?"
    ).all(THIRTY, THIRTY, now) as Array<{ publicKey: string; username: string }>;
    if (expired.length === 0) return 0;

    // Purge the account everywhere EXCEPT the DM history: deleting the user
    // row frees the username for re-signup, and we strip community membership,
    // friendships, friend requests and blocks so the user disappears from
    // every active surface. DM rows are KEPT so the other party's chat
    // history survives — getConversations() labels the now-missing user as
    // "(Deleted User)". (Tables are created defensively; ignore if absent.)
    const deleteUser = this.db.prepare('DELETE FROM users WHERE publicKey = ?');
    const deleteMember = this.db.prepare('DELETE FROM members WHERE publicKey = ?');
    const stmt = (sql: string) => { try { return this.db.prepare(sql); } catch { return null; } };
    const deleteFriends = stmt('DELETE FROM friends WHERE userA = ? OR userB = ?');
    const deleteFriendReqs = stmt('DELETE FROM friend_requests WHERE fromPublicKey = ? OR toPublicKey = ?');
    const deleteBlocks = stmt('DELETE FROM blocked_users WHERE blockerPublicKey = ? OR blockedPublicKey = ?');

    const transaction = this.db.transaction(() => {
      for (const user of expired) {
        deleteUser.run(user.publicKey);
        deleteMember.run(user.publicKey);
        deleteFriends?.run(user.publicKey, user.publicKey);
        deleteFriendReqs?.run(user.publicKey, user.publicKey);
        deleteBlocks?.run(user.publicKey, user.publicKey);
        console.log(`[user-db] Auto-deleted expired basic account: ${user.username} (DMs kept as (Deleted User))`);
      }
    });
    transaction();
    return expired.length;
  }

  getUserCount(): { total: number; basic: number; verified: number } {
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
    const verified = (this.db.prepare("SELECT COUNT(*) as c FROM users WHERE tier = 'verified'").get() as any).c;
    return { total, basic: total - verified, verified };
  }
}
