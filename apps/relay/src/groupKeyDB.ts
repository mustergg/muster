/**
 * Group Key Database — R22
 *
 * Stores encrypted group key bundles on the relay.
 * The relay never sees plaintext keys — only encrypted bundles.
 *
 * Tables:
 *   group_key_config  — per-channel encryption settings
 *   group_key_bundles — encrypted key epochs per recipient
 */

import type Database from 'better-sqlite3';

export interface GroupKeyConfig {
  channelId: string;
  enabled: number; // 0/1
  historyAccess: string; // 'all' | 'from_join' | 'from_date' | 'pinned_only'
  historyFromDate: number;
  currentEpoch: number;
  createdAt: number;
  updatedAt: number;
}

export interface GroupKeyBundle {
  channelId: string;
  epoch: number;
  recipientPublicKey: string;
  encryptedKey: string;
  nonce: string;
  distributorPublicKey: string;
  createdAt: number;
}

export class GroupKeyDB {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS group_key_config (
        channelId       TEXT PRIMARY KEY,
        enabled         INTEGER NOT NULL DEFAULT 0,
        historyAccess   TEXT NOT NULL DEFAULT 'from_join',
        historyFromDate INTEGER NOT NULL DEFAULT 0,
        currentEpoch    INTEGER NOT NULL DEFAULT 0,
        createdAt       INTEGER NOT NULL,
        updatedAt       INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS group_key_bundles (
        channelId            TEXT NOT NULL,
        epoch                INTEGER NOT NULL,
        recipientPublicKey   TEXT NOT NULL,
        encryptedKey         TEXT NOT NULL,
        nonce                TEXT NOT NULL,
        distributorPublicKey TEXT NOT NULL,
        createdAt            INTEGER NOT NULL,
        PRIMARY KEY (channelId, epoch, recipientPublicKey)
      );

      CREATE INDEX IF NOT EXISTS idx_gkb_channel_recipient
        ON group_key_bundles (channelId, recipientPublicKey);
    `);
    console.log('[relay-db] Group key tables initialized.');
  }

  // =================================================================
  // Config
  // =================================================================

  getConfig(channelId: string): GroupKeyConfig | null {
    return this.db.prepare('SELECT * FROM group_key_config WHERE channelId = ?').get(channelId) as GroupKeyConfig | null;
  }

  setConfig(channelId: string, enabled: boolean, historyAccess: string, historyFromDate?: number): void {
    const now = Date.now();
    const existing = this.getConfig(channelId);
    if (existing) {
      this.db.prepare(`
        UPDATE group_key_config SET enabled = ?, historyAccess = ?, historyFromDate = ?, updatedAt = ?
        WHERE channelId = ?
      `).run(enabled ? 1 : 0, historyAccess, historyFromDate || 0, now, channelId);
    } else {
      this.db.prepare(`
        INSERT INTO group_key_config (channelId, enabled, historyAccess, historyFromDate, currentEpoch, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `).run(channelId, enabled ? 1 : 0, historyAccess, historyFromDate || 0, now, now);
    }
  }

  incrementEpoch(channelId: string): number {
    const config = this.getConfig(channelId);
    const newEpoch = (config?.currentEpoch || 0) + 1;
    this.db.prepare('UPDATE group_key_config SET currentEpoch = ?, updatedAt = ? WHERE channelId = ?')
      .run(newEpoch, Date.now(), channelId);
    return newEpoch;
  }

  // =================================================================
  // Key bundles
  // =================================================================

  storeBundle(bundle: GroupKeyBundle): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO group_key_bundles
        (channelId, epoch, recipientPublicKey, encryptedKey, nonce, distributorPublicKey, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(bundle.channelId, bundle.epoch, bundle.recipientPublicKey, bundle.encryptedKey, bundle.nonce, bundle.distributorPublicKey, bundle.createdAt);
  }

  storeBundles(bundles: GroupKeyBundle[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO group_key_bundles
        (channelId, epoch, recipientPublicKey, encryptedKey, nonce, distributorPublicKey, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction(() => {
      for (const b of bundles) {
        stmt.run(b.channelId, b.epoch, b.recipientPublicKey, b.encryptedKey, b.nonce, b.distributorPublicKey, b.createdAt);
      }
    });
    tx();
  }

  /** Get all key epochs for a user in a channel. */
  getBundlesForUser(channelId: string, recipientPublicKey: string): GroupKeyBundle[] {
    return this.db.prepare(`
      SELECT * FROM group_key_bundles
      WHERE channelId = ? AND recipientPublicKey = ?
      ORDER BY epoch ASC
    `).all(channelId, recipientPublicKey) as GroupKeyBundle[];
  }

  /** Get bundles filtered by history access policy. */
  getBundlesForUserFiltered(channelId: string, recipientPublicKey: string, config: GroupKeyConfig, memberJoinedAt: number): GroupKeyBundle[] {
    const allBundles = this.getBundlesForUser(channelId, recipientPublicKey);

    switch (config.historyAccess) {
      case 'all':
        return allBundles;

      case 'from_join':
        // Only epochs created after the member joined
        return allBundles.filter((b) => b.createdAt >= memberJoinedAt);

      case 'from_date':
        // Only epochs created after the configured date
        return allBundles.filter((b) => b.createdAt >= (config.historyFromDate || 0));

      case 'pinned_only':
        // No keys — member can't decrypt anything (only sees pinned plaintext)
        return [];

      default:
        return allBundles;
    }
  }

  /** Delete all bundles for a specific user in a channel (on kick). */
  deleteBundlesForUser(channelId: string, recipientPublicKey: string): void {
    this.db.prepare('DELETE FROM group_key_bundles WHERE channelId = ? AND recipientPublicKey = ?')
      .run(channelId, recipientPublicKey);
  }

  /** Delete all bundles for a channel (on channel delete). */
  deleteBundlesForChannel(channelId: string): void {
    this.db.prepare('DELETE FROM group_key_bundles WHERE channelId = ?').run(channelId);
    this.db.prepare('DELETE FROM group_key_config WHERE channelId = ?').run(channelId);
  }

  /** Get the current epoch for a channel. */
  getCurrentEpoch(channelId: string): number {
    const config = this.getConfig(channelId);
    return config?.currentEpoch || 0;
  }
}
