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
import type {
  DBMessage,
  DBChannelSync,
  DBEnvelope,
  DBBlob,
  DBPiece,
  DBBlobPiece,
} from './types';

export class BrowserDB extends Dexie {
  messages!: Table<DBMessage, string>;
  channelSync!: Table<DBChannelSync, string>;
  // R25 — Phase 1: two-layer envelope + blob caches.
  envelopes!: Table<DBEnvelope, string>;
  blobs!: Table<DBBlob, string>;
  pieces!: Table<DBPiece, string>;
  blobPieces!: Table<DBBlobPiece, string>;

  constructor() {
    super('muster-db');

    this.version(1).stores({
      // Indexed fields — messageId is the primary key
      // [channel+timestamp] compound index for efficient range queries
      messages: 'messageId, channel, timestamp, [channel+timestamp]',

      // channelId is the primary key
      channelSync: 'channelId',
    });

    // R25 — Phase 1: add envelope + blob + piece tables. Old data preserved.
    this.version(2).stores({
      messages: 'messageId, channel, timestamp, [channel+timestamp]',
      channelSync: 'channelId',
      envelopes: 'envelopeId, channelId, communityId, ts, blobRoot, [channelId+ts]',
      blobs: 'root, firstSeenAt',
      pieces: 'pieceId, lastAccessedAt',
      blobPieces: 'key, root, pieceId',
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

  // =================================================================
  // R25 — Phase 1: envelopes, blobs, pieces
  // =================================================================

  /** Cache a received envelope. Silently ignores duplicates. */
  async addEnvelope(env: DBEnvelope): Promise<void> {
    try {
      await this.envelopes.put(env);
    } catch (err) {
      console.warn('[db] addEnvelope failed:', err);
    }
  }

  async getEnvelope(envelopeId: string): Promise<DBEnvelope | undefined> {
    return this.envelopes.get(envelopeId);
  }

  /** Get envelopes for a channel, ts-ascending, optionally since a cutoff. */
  async getEnvelopesByChannel(channelId: string, since: number = 0, limit: number = 500): Promise<DBEnvelope[]> {
    try {
      const arr = await this.envelopes
        .where('[channelId+ts]')
        .between([channelId, since], [channelId, Infinity])
        .limit(limit)
        .sortBy('ts');
      return arr;
    } catch (err) {
      console.warn('[db] getEnvelopesByChannel failed:', err);
      return [];
    }
  }

  async setEnvelopeBlobStatus(envelopeId: string, status: 'pending' | 'ready' | 'failed'): Promise<void> {
    await this.envelopes.update(envelopeId, { blobStatus: status });
  }

  async clearEnvelopesByChannel(channelId: string): Promise<void> {
    await this.envelopes.where('channelId').equals(channelId).delete();
  }

  // ── Blobs ────────────────────────────────────────────────────────

  async putBlob(blob: DBBlob): Promise<void> {
    await this.blobs.put(blob);
  }

  async getBlob(root: string): Promise<DBBlob | undefined> {
    return this.blobs.get(root);
  }

  // ── Pieces ───────────────────────────────────────────────────────

  async putPiece(piece: DBPiece): Promise<void> {
    await this.pieces.put(piece);
  }

  async getPiece(pieceId: string): Promise<DBPiece | undefined> {
    const p = await this.pieces.get(pieceId);
    if (p) {
      // Touch LRU.
      await this.pieces.update(pieceId, { lastAccessedAt: Date.now() });
    }
    return p;
  }

  async hasPiece(pieceId: string): Promise<boolean> {
    return (await this.pieces.where('pieceId').equals(pieceId).count()) > 0;
  }

  async linkBlobPiece(root: string, pieceIdx: number, pieceId: string): Promise<void> {
    await this.blobPieces.put({
      key: `${root}:${pieceIdx}`,
      root,
      pieceIdx,
      pieceId,
    });
  }

  async getBlobPieces(root: string): Promise<DBBlobPiece[]> {
    return this.blobPieces.where('root').equals(root).sortBy('pieceIdx');
  }
}
