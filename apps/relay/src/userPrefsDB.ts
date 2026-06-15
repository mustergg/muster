/**
 * User Prefs DB — per-user private preferences (pins, mutes, notification
 * levels) so they follow the user across devices. Stored as one JSON blob per
 * public key. Not E2E (relay metadata) — acceptable for the alpha threat model.
 */
import type Database from 'better-sqlite3';

export class UserPrefsDB {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_prefs (
        publicKey TEXT PRIMARY KEY,
        prefs     TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );
    `);
    console.log('[relay-db] User prefs table initialized.');
  }

  get(publicKey: string): Record<string, unknown> {
    const row = this.db.prepare('SELECT prefs FROM user_prefs WHERE publicKey = ?').get(publicKey) as { prefs: string } | undefined;
    if (!row) return {};
    try { return JSON.parse(row.prefs); } catch { return {}; }
  }

  set(publicKey: string, prefs: Record<string, unknown>): void {
    this.db.prepare(`
      INSERT INTO user_prefs (publicKey, prefs, updatedAt) VALUES (?, ?, ?)
      ON CONFLICT(publicKey) DO UPDATE SET prefs = excluded.prefs, updatedAt = excluded.updatedAt
    `).run(publicKey, JSON.stringify(prefs), Date.now());
  }
}
