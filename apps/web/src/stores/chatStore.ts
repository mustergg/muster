/**
 * Chat Store — R2 update
 *
 * Changes from R1:
 * - Messages are stored in IndexedDB (via BrowserDB/Dexie) on send and receive
 * - On init, messages are loaded from IndexedDB into state
 * - On subscribe, a SYNC_REQUEST is sent to get missed messages since last sync
 * - SYNC_RESPONSE handler stores synced messages in IndexedDB and updates state
 */

import { create } from 'zustand';
import { useNetworkStore } from './networkStore';
import { BrowserDB, type DBMessage } from '@muster/db';
import type { TransportMessage } from '@muster/transport';

// Stub sign — replace with @muster/crypto
function sign(message: string, _privateKey: string): string {
  return 'stub-signature-' + message.slice(0, 8);
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// =================================================================
// Types
// =================================================================

export interface ChatMessage {
  messageId: string;
  channel: string;
  content: string;
  senderPublicKey: string;
  senderUsername: string;
  timestamp: number;
  isOwn: boolean;
}

export interface PresenceUser {
  publicKey: string;
  username: string;
  status: string;
}

interface ChatState {
  messages: Record<string, ChatMessage[]>;
  presence: Record<string, PresenceUser[]>;
  activeChannel: string | null;
  subscribe: (channels: string[]) => void;
  unsubscribe: (channels: string[]) => void;
  sendMessage: (channel: string, content: string) => void;
  setActiveChannel: (channelId: string | null) => void;
  clear: () => void;
  init: () => () => void;
}

// =================================================================
// Database singleton
// =================================================================

const browserDB = new BrowserDB();

// =================================================================
// Helpers
// =================================================================

function dbMsgToChatMsg(msg: DBMessage, myPublicKey: string): ChatMessage {
  return {
    messageId: msg.messageId,
    channel: msg.channel,
    content: msg.content,
    senderPublicKey: msg.senderPublicKey,
    senderUsername: msg.senderUsername,
    timestamp: msg.timestamp,
    isOwn: msg.senderPublicKey === myPublicKey,
  };
}

// =================================================================
// Store
// =================================================================

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  presence: {},
  activeChannel: null,

  subscribe: (channelIds) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) {
      console.warn('[chat] Cannot subscribe — not connected');
      return;
    }

    // Subscribe on the relay
    transport.send({
      type: 'SUBSCRIBE',
      payload: { channels: channelIds },
      timestamp: Date.now(),
    });

    // For each channel, load local messages and request sync
    const myKey = useNetworkStore.getState().publicKey;

    for (const channelId of channelIds) {
      // Load existing messages from IndexedDB
      browserDB.getMessages(channelId).then((dbMsgs) => {
        if (dbMsgs.length > 0) {
          const chatMsgs = dbMsgs.map((m) => dbMsgToChatMsg(m, myKey));
          set((state) => ({
            messages: {
              ...state.messages,
              [channelId]: chatMsgs,
            },
          }));
        }
      });

      // Request sync from relay — get messages since our last known timestamp
      browserDB.getLatestTimestamp(channelId).then((since) => {
        console.log(
          `[chat] Sync request for #${channelId.slice(0, 8)}...`
          + ` since ${since ? new Date(since).toISOString() : 'beginning'}`
        );
        transport.send({
          type: 'SYNC_REQUEST',
          payload: { channel: channelId, since },
          timestamp: Date.now(),
        });
      });
    }
  },

  unsubscribe: (channelIds) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({
      type: 'UNSUBSCRIBE',
      payload: { channels: channelIds },
      timestamp: Date.now(),
    });
  },

  sendMessage: (channel, content) => {
    const network = useNetworkStore.getState();
    if (!network.transport?.isConnected) {
      console.warn('[chat] Cannot send — not connected');
      return;
    }

    const messageId = uuid();
    const timestamp = Date.now();
    const payload = { channel, content, messageId, timestamp };
    const signature = sign(JSON.stringify(payload), network.publicKey);

    // Send to relay
    network.transport.send({
      type: 'PUBLISH',
      payload,
      timestamp,
      signature,
      senderPublicKey: network.publicKey,
    });

    // Store in IndexedDB
    const dbMsg: DBMessage = {
      messageId,
      channel,
      content,
      senderPublicKey: network.publicKey,
      senderUsername: network.username,
      timestamp,
      signature,
    };
    browserDB.addMessage(dbMsg);
    browserDB.setLastSyncTimestamp(channel, timestamp);

    // Add to state (optimistic update)
    const chatMsg: ChatMessage = {
      messageId,
      channel,
      content,
      senderPublicKey: network.publicKey,
      senderUsername: network.username,
      timestamp,
      isOwn: true,
    };

    set((state) => ({
      messages: {
        ...state.messages,
        [channel]: [...(state.messages[channel] || []), chatMsg],
      },
    }));
  },

  setActiveChannel: (channelId) => {
    set({ activeChannel: channelId });
  },

  clear: () => {
    browserDB.clearAll();
    set({ messages: {}, presence: {}, activeChannel: null });
  },

  init: () => {
    const network = useNetworkStore.getState();
    const myKey = network.publicKey;

    const unsubscribe = network.onMessage((msg: TransportMessage) => {
      switch (msg.type) {
        case 'MESSAGE': {
          const p = msg.payload as any;

          const chatMsg: ChatMessage = {
            messageId: p.messageId,
            channel: p.channel,
            content: p.content,
            senderPublicKey: p.senderPublicKey,
            senderUsername: p.senderUsername,
            timestamp: p.timestamp,
            isOwn: p.senderPublicKey === myKey,
          };

          // Store in IndexedDB
          const dbMsg: DBMessage = {
            messageId: p.messageId,
            channel: p.channel,
            content: p.content,
            senderPublicKey: p.senderPublicKey,
            senderUsername: p.senderUsername,
            timestamp: p.timestamp,
            signature: (msg as any).signature || '',
          };
          browserDB.addMessage(dbMsg);
          browserDB.setLastSyncTimestamp(p.channel, p.timestamp);

          // Add to state (skip duplicates)
          set((state) => {
            const existing = state.messages[p.channel] || [];
            if (existing.some((m) => m.messageId === chatMsg.messageId)) {
              return state;
            }
            return {
              messages: {
                ...state.messages,
                [p.channel]: [...existing, chatMsg].sort(
                  (a, b) => a.timestamp - b.timestamp
                ),
              },
            };
          });
          break;
        }

        case 'SYNC_RESPONSE': {
          const p = msg.payload as any;
          const syncedMessages: any[] = p.messages || [];

          if (syncedMessages.length === 0) {
            console.log(`[chat] Sync: no new messages for #${p.channel?.slice(0, 8)}...`);
            break;
          }

          console.log(
            `[chat] Sync: received ${syncedMessages.length} messages`
            + ` for #${p.channel?.slice(0, 8)}...`
          );

          // Store all synced messages in IndexedDB
          const dbMsgs: DBMessage[] = syncedMessages.map((m: any) => ({
            messageId: m.messageId,
            channel: m.channel,
            content: m.content,
            senderPublicKey: m.senderPublicKey,
            senderUsername: m.senderUsername,
            timestamp: m.timestamp,
            signature: '',
          }));
          browserDB.addMessages(dbMsgs);

          // Update last sync timestamp
          const maxTs = Math.max(...syncedMessages.map((m: any) => m.timestamp));
          browserDB.setLastSyncTimestamp(p.channel, maxTs);

          // Merge into state
          const chatMsgs: ChatMessage[] = syncedMessages.map((m: any) => ({
            messageId: m.messageId,
            channel: m.channel,
            content: m.content,
            senderPublicKey: m.senderPublicKey,
            senderUsername: m.senderUsername,
            timestamp: m.timestamp,
            isOwn: m.senderPublicKey === myKey,
          }));

          set((state) => {
            const existing = state.messages[p.channel] || [];
            const existingIds = new Set(existing.map((m) => m.messageId));
            const newMsgs = chatMsgs.filter((m) => !existingIds.has(m.messageId));
            if (newMsgs.length === 0) return state;

            return {
              messages: {
                ...state.messages,
                [p.channel]: [...existing, ...newMsgs].sort(
                  (a, b) => a.timestamp - b.timestamp
                ),
              },
            };
          });
          break;
        }

        case 'PRESENCE': {
          const p = msg.payload as any;
          set((state) => ({
            presence: {
              ...state.presence,
              [p.channel]: p.users || [],
            },
          }));
          break;
        }
      }
    });

    return unsubscribe;
  },
}));

// TEMPORARY: expose store for R1/R2 testing — remove after R3
(window as any).__chat = useChatStore;
