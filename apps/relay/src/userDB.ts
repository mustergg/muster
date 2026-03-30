/**
 * User Database — SQLite tables for user accounts and verification.
 *
 * Tracks: registration, email verification, tier (basic/verified),
 * auto-deletion countdown for basic users.
 */

import type Database from 'better-sqlite3';
import { createHash, randomBytes } from 'crypto';

export interface DBUser {
  publicKey: string;
  username: string;
  tier: 'basic' | 'verified';
  emailHash: string;        // SHA-256 of email (empty if no email registered)
  verificationCode: string; // 8-char code (empty if verified or no email)
  verificationExpiry: number; // timestamp when code expires (0 if none)
  createdAt: number;
  lastSeen: number;
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

  /** Ensure a user record exists. Called on every successful auth. */
  ensureUser(publicKey: string, username: string): DBUser {
    const existing = this.getUser(publicKey);
    if (existing) {
      // Update lastSeen and username (in case it changed)
      this.db.prepare(
        'UPDATE users SET lastSeen = ?, username = ? WHERE publicKey = ?'
      ).run(Date.now(), username, publicKey);
      return { ...existing, lastSeen: Date.now(), username };
    }

    // Create new basic user
    const now = Date.now();
    const user: DBUser = {
      publicKey, username, tier: 'basic',
      emailHash: '', verificationCode: '', verificationExpiry: 0,
      createdAt: now, lastSeen: now,
    };

    this.db.prepare(`
      INSERT INTO users (publicKey, username, tier, emailHash, verificationCode, verificationExpiry, createdAt, lastSeen)
      VALUES (@publicKey, @username, @tier, @emailHash, @verificationCode, @verificationExpiry, @createdAt, @lastSeen)
    `).run(user);

    console.log(`[user-db] New basic user: ${username} (30-day timer started)`);
    return user;
  }

  getUser(publicKey: string): DBUser | undefined {
    return this.db.prepare('SELECT * FROM users WHERE publicKey = ?').get(publicKey) as DBUser | undefined;
  }

  // =================================================================
  // Email verification
  // =================================================================

  /** Hash an email address (for uniqueness checks without storing plaintext). */
  static hashEmail(email: string): string {
    return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
  }

  /** Generate a random 8-character alphanumeric verification code. */
  static generateCode(): string {
    return randomBytes(4).toString('hex').toUpperCase(); // 8 chars
  }

  /** Register an email and generate a verification code. Returns the code. */
  registerEmail(publicKey: string, email: string): { code: string; error?: string } {
    const emailHash = UserDB.hashEmail(email);

    // Check if email is already used by another account
    const existing = this.db.prepare(
      'SELECT publicKey FROM users WHERE emailHash = ? AND publicKey != ?'
    ).get(emailHash, publicKey) as any;

    if (existing) {
      return { code: '', error: 'This email is already associated with another account.' };
    }

    const code = UserDB.generateCode();
    const expiry = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    this.db.prepare(
      'UPDATE users SET emailHash = ?, verificationCode = ?, verificationExpiry = ? WHERE publicKey = ?'
    ).run(emailHash, code, expiry, publicKey);

    return { code };
  }

  /** Verify an email with the provided code. Returns true if successful. */
  verifyEmail(publicKey: string, code: string): { success: boolean; error?: string } {
    const user = this.getUser(publicKey);
    if (!user) return { success: false, error: 'User not found' };
    if (user.tier === 'verified') return { success: false, error: 'Already verified' };
    if (!user.verificationCode) return { success: false, error: 'No verification pending' };
    if (Date.now() > user.verificationExpiry) return { success: false, error: 'Verification code expired. Request a new one.' };
    if (user.verificationCode !== code.toUpperCase().trim()) return { success: false, error: 'Invalid verification code' };

    // Upgrade to verified
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

  /** Get days remaining before auto-deletion (basic users). Returns 0 for verified. */
  getDaysRemaining(publicKey: string): number {
    const user = this.getUser(publicKey);
    if (!user || user.tier === 'verified') return 0;
    const elapsed = Date.now() - user.createdAt;
    const remaining = Math.ceil((30 * 24 * 60 * 60 * 1000 - elapsed) / (24 * 60 * 60 * 1000));
    return Math.max(0, remaining);
  }

  /** Build account info for sending to client. */
  getAccountInfo(publicKey: string): {
    publicKey: string; username: string; tier: string;
    emailVerified: boolean; createdAt: number; daysRemaining: number;
  } {
    const user = this.getUser(publicKey);
    if (!user) return { publicKey, username: '', tier: 'basic', emailVerified: false, createdAt: 0, daysRemaining: 30 };
    return {
      publicKey: user.publicKey,
      username: user.username,
      tier: user.tier,
      emailVerified: user.tier === 'verified',
      createdAt: user.createdAt,
      daysRemaining: this.getDaysRemaining(publicKey),
    };
  }

  // =================================================================
  // Cleanup — auto-delete expired basic accounts
  // =================================================================

  /** Delete basic accounts older than 30 days. Returns count of deleted accounts. */
  deleteExpiredAccounts(): number {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const expired = this.db.prepare(
      "SELECT publicKey, username FROM users WHERE tier = 'basic' AND createdAt < ?"
    ).all(cutoff) as Array<{ publicKey: string; username: string }>;

    if (expired.length === 0) return 0;

    const deleteUser = this.db.prepare('DELETE FROM users WHERE publicKey = ?');
    const deleteMember = this.db.prepare('DELETE FROM members WHERE publicKey = ?');
    const deleteDMs = this.db.prepare(
      'DELETE FROM direct_messages WHERE senderPublicKey = ? OR recipientPublicKey = ?'
    );

    const transaction = this.db.transaction(() => {
      for (const user of expired) {
        deleteUser.run(user.publicKey);
        deleteMember.run(user.publicKey);
        deleteDMs.run(user.publicKey, user.publicKey);
        console.log(`[user-db] Auto-deleted expired basic account: ${user.username}`);
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
