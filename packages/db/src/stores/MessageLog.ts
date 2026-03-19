// @ts-nocheck
/**
 * @muster/db — MessageLog store
 *
 * An append-only OrbitDB log of chat messages for a single channel.
 * One MessageLog per channel. Automatically replicates between all
 * peers that have the same channel open.
 *
 * Architecture:
 *   - Write: when a user sends a message, it is appended to the log
 *   - Read: all entries in the log are the channel's message history
 *   - Sync: OrbitDB handles replication — peers with the same log
 *     address automatically sync entries between each other
 */

import type { StoredChatMessage } from '../types.js';

export interface MessageLogOptions {
  orbitdb: any;
  communityId: string;
  channelId: string;
}

export interface MessageLogStore {
  /** Append a message to the log */
  add: (message: StoredChatMessage) => Promise<string>;
  /** Get all messages, oldest first */
  all: () => StoredChatMessage[];
  /** Get messages after a specific timestamp */
  since: (ts: number) => StoredChatMessage[];
  /** Mark a message as deleted (tombstone) */
  delete: (messageId: string, actorPublicKeyHex: string) => Promise<void>;
  /** The OrbitDB database address — share this with peers */
  address: string;
  /** Close the database */
  close: () => Promise<void>;
}

/**
 * Open or create a MessageLog for a channel.
 *
 * @param options - Community ID, channel ID, and OrbitDB instance
 * @returns A typed MessageLog store
 */
export async function openMessageLog(
  options: MessageLogOptions,
): Promise<MessageLogStore> {
  const { orbitdb, communityId, channelId } = options;

  // Database name is deterministic from communityId + channelId
  // All peers with the same community/channel open the same database
  const dbName = `muster.${communityId}.channel.${channelId}`;

  const db = await orbitdb.open(dbName, {
    type: 'events', // append-only event log
  });

  // Wait for initial sync with any connected peers
  await new Promise<void>((resolve) => {
    // Give peers up to 2 seconds to provide history on open
    const timer = setTimeout(resolve, 2000);
    db.events.addEventListener('update', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  return {
    address: db.address,

    add: async (message: StoredChatMessage): Promise<string> => {
      return db.add(message);
    },

    all: (): StoredChatMessage[] => {
      const entries: StoredChatMessage[] = [];
      for (const entry of db.iterator()) {
        if (entry.payload?.value) {
          entries.push(entry.payload.value as StoredChatMessage);
        }
      }
      // Sort by timestamp, oldest first
      return entries.sort((a, b) => a.ts - b.ts);
    },

    since: (ts: number): StoredChatMessage[] => {
      const entries: StoredChatMessage[] = [];
      for (const entry of db.iterator()) {
        if (entry.payload?.value) {
          const msg = entry.payload.value as StoredChatMessage;
          if (msg.ts > ts) entries.push(msg);
        }
      }
      return entries.sort((a, b) => a.ts - b.ts);
    },

    delete: async (messageId: string, actorPublicKeyHex: string): Promise<void> => {
      // Append a tombstone entry — we never remove from the log, only mark deleted
      const tombstone: StoredChatMessage = {
        id:                 messageId,
        communityId,
        channelId,
        senderPublicKeyHex: actorPublicKeyHex,
        senderUsername:     '',
        content:            '',
        ts:                 Date.now(),
        signature:          '',
        deleted:            true,
      };
      await db.add(tombstone);
    },

    close: async (): Promise<void> => {
      await db.close();
    },
  };
}
