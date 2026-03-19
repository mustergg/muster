// @ts-nocheck
/**
 * @muster/db — MusterDB
 *
 * The central database manager. Creates and holds references to all
 * OrbitDB stores. This is the single entry point for all database
 * operations in Muster.
 *
 * Usage:
 *   const db = await MusterDB.create({ storagePath: '/data/muster' });
 *   await db.openCommunity('abc123');
 *   const messages = db.getMessageLog('abc123', 'general-channel-id').all();
 */

import { createOrbitDB } from '@orbitdb/core';
import { createHeliaNode, type HeliaConfig } from './helia.js';
import { openMessageLog, type MessageLogStore } from './stores/MessageLog.js';
import { openCommunityStore, type CommunityStore } from './stores/CommunityStore.js';
import { openUserRegistry, type UserRegistry } from './stores/UserRegistry.js';
import type { StoredChatMessage, StoredCommunity, StoredCommunityMember } from './types.js';

export interface MusterDBConfig extends HeliaConfig {
  /** Optional: provide an existing libp2p node for OrbitDB to use */
  libp2p?: any;
}

export class MusterDB {
  private orbitdb: any;
  private helia: any;

  // Active stores — opened on demand, cached after first open
  private messageLogs   = new Map<string, MessageLogStore>();   // key: `${communityId}:${channelId}`
  private communityStores = new Map<string, CommunityStore>(); // key: communityId
  private userRegistryStore?: UserRegistry;

  private constructor() {}

  /**
   * Create and initialise a MusterDB instance.
   *
   * @param config - Storage path (Node.js) or empty for browser in-memory
   */
  static async create(config: MusterDBConfig = {}): Promise<MusterDB> {
    const instance = new MusterDB();
    instance.helia   = await createHeliaNode(config);
    instance.orbitdb = await createOrbitDB({
      ipfs: instance.helia,
      ...(config.libp2p ? { libp2p: config.libp2p } : {}),
    });
    return instance;
  }

  // ─── User Registry ──────────────────────────────────────────────────────────

  /**
   * Open the global user registry (shared across the entire network).
   * Idempotent — returns the cached instance if already open.
   */
  async getUserRegistry(): Promise<UserRegistry> {
    if (!this.userRegistryStore) {
      this.userRegistryStore = await openUserRegistry({ orbitdb: this.orbitdb });
    }
    return this.userRegistryStore;
  }

  // ─── Community ──────────────────────────────────────────────────────────────

  /**
   * Open all stores for a community.
   * Call this when the user joins or opens a community.
   */
  async openCommunity(communityId: string): Promise<CommunityStore> {
    if (this.communityStores.has(communityId)) {
      return this.communityStores.get(communityId)!;
    }
    const store = await openCommunityStore({
      orbitdb: this.orbitdb,
      communityId,
    });
    this.communityStores.set(communityId, store);
    return store;
  }

  getCommunityStore(communityId: string): CommunityStore | undefined {
    return this.communityStores.get(communityId);
  }

  // ─── Message Logs ────────────────────────────────────────────────────────────

  /**
   * Open the message log for a channel.
   * Idempotent — returns cached instance if already open.
   */
  async openMessageLog(communityId: string, channelId: string): Promise<MessageLogStore> {
    const key = `${communityId}:${channelId}`;
    if (this.messageLogs.has(key)) {
      return this.messageLogs.get(key)!;
    }
    const log = await openMessageLog({
      orbitdb:     this.orbitdb,
      communityId,
      channelId,
    });
    this.messageLogs.set(key, log);
    return log;
  }

  getMessageLog(communityId: string, channelId: string): MessageLogStore | undefined {
    return this.messageLogs.get(`${communityId}:${channelId}`);
  }

  // ─── Convenience methods ─────────────────────────────────────────────────────

  /**
   * Persist a chat message to its channel's log.
   * Called after a message is sent or received via GossipSub.
   */
  async persistMessage(message: StoredChatMessage): Promise<void> {
    const log = await this.openMessageLog(message.communityId, message.channelId);
    await log.add(message);
  }

  /**
   * Get all messages for a channel (from local store).
   * Returns empty array if the log is not open yet.
   */
  getChannelMessages(communityId: string, channelId: string): StoredChatMessage[] {
    const log = this.getMessageLog(communityId, channelId);
    if (!log) return [];
    return log.all();
  }

  /**
   * Get messages for a channel since a given timestamp.
   * Used for "catch up" after offline period.
   */
  getMessagesSince(communityId: string, channelId: string, ts: number): StoredChatMessage[] {
    const log = this.getMessageLog(communityId, channelId);
    if (!log) return [];
    return log.since(ts);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Close all open stores and shut down OrbitDB + Helia.
   * Call this when the user logs out or the app closes.
   */
  async close(): Promise<void> {
    const closeTasks: Promise<void>[] = [];

    for (const log of this.messageLogs.values()) {
      closeTasks.push(log.close());
    }
    for (const store of this.communityStores.values()) {
      closeTasks.push(store.close());
    }
    if (this.userRegistryStore) {
      closeTasks.push(this.userRegistryStore.close());
    }

    await Promise.allSettled(closeTasks);
    await this.orbitdb.stop();
    await this.helia.stop();
  }
}
