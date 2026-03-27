/**
 * BrowserDB — persistent message storage in the browser using Dexie.js (IndexedDB).
 *
 * Stores messages locally so they survive browser refresh.
 * Tracks sync timestamps per channel so the client knows what to request on reconnect.
 *
 * Usage:
 *   const db = new BrowserDB();
 *   await db.addMessage(msg);
 *   const msgs = await db.getMessages('channel-id');
 *   const since = await db.getLastSyncTimestamp('channel-id');
 */

import Dexie, { type Table } from 'dexie';
import type { DBMessage, DBChannelSync } from './types';

export class BrowserDB extends Dexie {
  messages!: Table<DBMessage, string>;
  channelSync!: Table<DBChannelSync, string>;

  constructor() {
    super('muster-db');

    this.version(1).stores({
      // Indexed fields — messageId is the primary key
      // [channel+timestamp] compound index for efficient range queries
      messages: 'messageId, channel, timestamp, [channel+timestamp]',

      // channelId is the primary key
      channelSync: 'channelId',
    });
  }

  // =================================================================
  // Messages
  // =================================================================

  /** Add a single message. Silently ignores duplicates (same messageId). */
  async addMessage(msg: DBMessage): Promise<void> {
    try {
      await this.messages.put(msg);
    } catch (err) {
      console.warn('[db] Failed to store message:', err);
    }
  }

  /** Add multiple messages at once (used during sync). */
  async addMessages(msgs: DBMessage[]): Promise<void> {
    if (msgs.length === 0) return;
    try {
      await this.messages.bulkPut(msgs);
    } catch (err) {
      console.warn('[db] Failed to bulk store messages:', err);
    }
  }

  /**
   * Get all messages for a channel, sorted by timestamp ascending.
   * Optionally filter by timestamp range.
   */
  async getMessages(channel: string, since?: number): Promise<DBMessage[]> {
    try {
      let query = this.messages
        .where('[channel+timestamp]')
        .between(
          [channel, since ?? 0],
          [channel, Infinity]
        );
      return await query.sortBy('timestamp');
    } catch (err) {
      console.warn('[db] Failed to get messages:', err);
      return [];
    }
  }

  /** Get the most recent message timestamp for a channel. */
  async getLatestTimestamp(channel: string): Promise<number> {
    try {
      const latest = await this.messages
        .where('channel')
        .equals(channel)
        .reverse()
        .sortBy('timestamp');
      return latest.length > 0 ? latest[0].timestamp : 0;
    } catch {
      return 0;
    }
  }

  /** Delete all messages for a channel. */
  async clearChannel(channel: string): Promise<void> {
    await this.messages.where('channel').equals(channel).delete();
  }

  /** Delete all data (logout / account reset). */
  async clearAll(): Promise<void> {
    await this.messages.clear();
    await this.channelSync.clear();
  }

  // =================================================================
  // Sync tracking
  // =================================================================

  /** Get the last sync timestamp for a channel (0 if never synced). */
  async getLastSyncTimestamp(channel: string): Promise<number> {
    try {
      const record = await this.channelSync.get(channel);
      return record?.lastSyncTimestamp ?? 0;
    } catch {
      return 0;
    }
  }

  /** Update the last sync timestamp for a channel. */
  async setLastSyncTimestamp(channel: string, timestamp: number): Promise<void> {
    await this.channelSync.put({ channelId: channel, lastSyncTimestamp: timestamp });
  }
}
