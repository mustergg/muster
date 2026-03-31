/**
 * Chat Store — Real Crypto Integration
 *
 * Changes: Replaced stub sign() with real Ed25519 signing from @muster/crypto.
 * Messages are now signed with the user's actual private key before publishing.
 */

import { create } from 'zustand';
import { useNetworkStore } from './networkStore';
import { BrowserDB, type DBMessage } from '@muster/db';
import { sign as ed25519Sign, toHex } from '@muster/crypto';
import type { TransportMessage } from '@muster/transport';

const encoder = new TextEncoder();

/** Sign a string payload with Ed25519 and return hex signature. */
async function signPayload(payload: string, privateKey: Uint8Array): Promise<string> {
  const sigBytes = await ed25519Sign(encoder.encode(payload), privateKey);
  return toHex(sigBytes);
}

/** Get the current user's private key from authStore. */
function getPrivateKey(): Uint8Array | null {
  try {
    // Access via window global set by authStore (avoids circular import issues with Vite)
    const authStore = (window as any).__authStore;
    if (authStore) return authStore.getState()._keypair?.privateKey ?? null;
    return null;
  } catch {
    return null;
  }
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface ChatMessage {
  messageId: string; channel: string; content: string;
  senderPublicKey: string; senderUsername: string; timestamp: number; isOwn: boolean;
}

export interface PresenceUser { publicKey: string; username: string; status: string; }

interface ChatState {
  messages: Record<string, ChatMessage[]>;
  presence: Record<string, PresenceUser[]>;
  activeChannel: string | null;
  subscribe: (channels: string[]) => void;
  unsubscribe: (channels: string[]) => void;
  sendMessage: (channel: string, content: string) => void;
  deleteMessage: (channel: string, messageId: string) => void;
  setActiveChannel: (channelId: string | null) => void;
  clear: () => void;
  init: () => () => void;
}

const browserDB = new BrowserDB();

function dbMsgToChatMsg(msg: DBMessage, myKey: string): ChatMessage {
  return { messageId: msg.messageId, channel: msg.channel, content: msg.content, senderPublicKey: msg.senderPublicKey, senderUsername: msg.senderUsername, timestamp: msg.timestamp, isOwn: msg.senderPublicKey === myKey };
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  presence: {},
  activeChannel: null,

  subscribe: (channelIds) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'SUBSCRIBE', payload: { channels: channelIds }, timestamp: Date.now() });

    const myKey = useNetworkStore.getState().publicKey;
    for (const channelId of channelIds) {
      browserDB.getMessages(channelId).then((dbMsgs) => {
        if (dbMsgs.length > 0) {
          set((state) => ({ messages: { ...state.messages, [channelId]: dbMsgs.map((m) => dbMsgToChatMsg(m, myKey)) } }));
        }
      });
      browserDB.getLatestTimestamp(channelId).then((since) => {
        transport.send({ type: 'SYNC_REQUEST', payload: { channel: channelId, since }, timestamp: Date.now() });
      });
    }
  },

  unsubscribe: (channelIds) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'UNSUBSCRIBE', payload: { channels: channelIds }, timestamp: Date.now() });
  },

  sendMessage: (channel, content) => {
    const network = useNetworkStore.getState();
    if (!network.transport?.isConnected) return;

    const messageId = uuid();
    const timestamp = Date.now();
    const payload = { channel, content, messageId, timestamp };
    const payloadStr = JSON.stringify(payload);

    // Optimistic update — add message to UI immediately
    const dbMsg: DBMessage = { messageId, channel, content, senderPublicKey: network.publicKey, senderUsername: network.username, timestamp, signature: '' };
    browserDB.addMessage(dbMsg);
    browserDB.setLastSyncTimestamp(channel, timestamp);

    set((state) => ({
      messages: { ...state.messages, [channel]: [...(state.messages[channel] || []), { messageId, channel, content, senderPublicKey: network.publicKey, senderUsername: network.username, timestamp, isOwn: true }] },
    }));

    // Sign and send asynchronously
    const privateKey = getPrivateKey();
    if (privateKey) {
      signPayload(payloadStr, privateKey).then((signature) => {
        network.transport!.send({ type: 'PUBLISH', payload, timestamp, signature, senderPublicKey: network.publicKey });
      }).catch((err) => {
        console.error('[chat] Failed to sign message:', err);
        // Send unsigned as fallback (relay will accept if signature verification is optional)
        network.transport!.send({ type: 'PUBLISH', payload, timestamp, signature: '', senderPublicKey: network.publicKey });
      });
    } else {
      // No private key — send unsigned
      console.warn('[chat] No private key available — sending unsigned message');
      network.transport!.send({ type: 'PUBLISH', payload, timestamp, signature: '', senderPublicKey: network.publicKey });
    }
  },

  deleteMessage: (channel, messageId) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'DELETE_MESSAGE', payload: { channel, messageId }, timestamp: Date.now() });
  },

  setActiveChannel: (channelId) => set({ activeChannel: channelId }),
  clear: () => { browserDB.clearAll(); set({ messages: {}, presence: {}, activeChannel: null }); },

  init: () => {
    const network = useNetworkStore.getState();
    const myKey = network.publicKey;

    const unsubscribe = network.onMessage((msg: TransportMessage) => {
      switch (msg.type) {
        case 'MESSAGE': {
          const p = msg.payload as any;
          const chatMsg: ChatMessage = { messageId: p.messageId, channel: p.channel, content: p.content, senderPublicKey: p.senderPublicKey, senderUsername: p.senderUsername, timestamp: p.timestamp, isOwn: p.senderPublicKey === myKey };
          browserDB.addMessage({ messageId: p.messageId, channel: p.channel, content: p.content, senderPublicKey: p.senderPublicKey, senderUsername: p.senderUsername, timestamp: p.timestamp, signature: (msg as any).signature || '' });
          browserDB.setLastSyncTimestamp(p.channel, p.timestamp);
          set((state) => {
            const existing = state.messages[p.channel] || [];
            if (existing.some((m) => m.messageId === chatMsg.messageId)) return state;
            return { messages: { ...state.messages, [p.channel]: [...existing, chatMsg].sort((a, b) => a.timestamp - b.timestamp) } };
          });
          break;
        }

        case 'SYNC_RESPONSE': {
          const p = msg.payload as any;
          const synced: any[] = p.messages || [];
          if (synced.length === 0) break;
          const dbMsgs: DBMessage[] = synced.map((m: any) => ({ messageId: m.messageId, channel: m.channel, content: m.content, senderPublicKey: m.senderPublicKey, senderUsername: m.senderUsername, timestamp: m.timestamp, signature: '' }));
          browserDB.addMessages(dbMsgs);
          const maxTs = Math.max(...synced.map((m: any) => m.timestamp));
          browserDB.setLastSyncTimestamp(p.channel, maxTs);
          const chatMsgs: ChatMessage[] = synced.map((m: any) => ({ messageId: m.messageId, channel: m.channel, content: m.content, senderPublicKey: m.senderPublicKey, senderUsername: m.senderUsername, timestamp: m.timestamp, isOwn: m.senderPublicKey === myKey }));
          set((state) => {
            const existing = state.messages[p.channel] || [];
            const ids = new Set(existing.map((m) => m.messageId));
            const newMsgs = chatMsgs.filter((m) => !ids.has(m.messageId));
            if (newMsgs.length === 0) return state;
            return { messages: { ...state.messages, [p.channel]: [...existing, ...newMsgs].sort((a, b) => a.timestamp - b.timestamp) } };
          });
          break;
        }

        case 'MESSAGE_DELETED': {
          const p = msg.payload as any;
          console.log(`[chat] Message ${p.messageId?.slice(0, 8)}... deleted by ${p.deletedBy}`);
          set((state) => {
            const existing = state.messages[p.channel] || [];
            return { messages: { ...state.messages, [p.channel]: existing.filter((m) => m.messageId !== p.messageId) } };
          });
          break;
        }

        case 'PRESENCE': {
          const p = msg.payload as any;
          set((state) => ({ presence: { ...state.presence, [p.channel]: p.users || [] } }));
          break;
        }
      }
    });

    return unsubscribe;
  },
}));

(window as any).__chat = useChatStore;
