/**
 * DM Store — R5b update
 * Changes: Added clearConversation() for deleting local DM conversations.
 */

import { create } from 'zustand';
import { useNetworkStore } from './networkStore';
import { BrowserDB } from '@muster/db';
import type { TransportMessage } from '@muster/transport';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
function sign(message: string, _key: string): string { return 'stub-sig-' + message.slice(0, 8); }

export interface DMMessage {
  messageId: string; content: string; senderPublicKey: string; senderUsername: string;
  recipientPublicKey: string; timestamp: number; isOwn: boolean;
}

export interface DMConversation {
  publicKey: string; username: string; lastMessage: string; lastTimestamp: number; unreadCount: number;
}

interface DMState {
  messages: Record<string, DMMessage[]>;
  conversations: DMConversation[];
  activeConversation: string | null;
  sendDM: (recipientPublicKey: string, content: string) => void;
  openConversation: (publicKey: string) => void;
  loadConversations: () => void;
  setActiveConversation: (publicKey: string | null) => void;
  /** Clear a conversation locally (remove from list and messages). */
  clearConversation: (publicKey: string) => void;
  init: () => () => void;
}

const dmDB = new BrowserDB();

export const useDMStore = create<DMState>((set, get) => ({
  messages: {},
  conversations: [],
  activeConversation: null,

  sendDM: (recipientPublicKey, content) => {
    const network = useNetworkStore.getState();
    if (!network.transport?.isConnected) return;
    const messageId = uuid();
    const timestamp = Date.now();
    const payload = { recipientPublicKey, content, messageId, timestamp };
    const signature = sign(JSON.stringify(payload), network.publicKey);
    network.transport.send({ type: 'SEND_DM', payload, signature, senderPublicKey: network.publicKey, timestamp });
    const msg: DMMessage = { messageId, content, senderPublicKey: network.publicKey, senderUsername: network.username, recipientPublicKey, timestamp, isOwn: true };
    set((state) => ({
      messages: { ...state.messages, [recipientPublicKey]: [...(state.messages[recipientPublicKey] || []), msg] },
    }));
    dmDB.addMessage({ messageId, channel: `dm:${[network.publicKey, recipientPublicKey].sort().join(':')}`, content, senderPublicKey: network.publicKey, senderUsername: network.username, timestamp, signature });
  },

  openConversation: (publicKey) => {
    set({ activeConversation: publicKey });
    const network = useNetworkStore.getState();
    if (!network.transport?.isConnected) return;
    network.transport.send({ type: 'DM_HISTORY_REQUEST', payload: { otherPublicKey: publicKey, since: 0 }, timestamp: Date.now() });
  },

  loadConversations: () => {
    const network = useNetworkStore.getState();
    if (!network.transport?.isConnected) return;
    network.transport.send({ type: 'DM_CONVERSATIONS_REQUEST', payload: {}, timestamp: Date.now() });
  },

  setActiveConversation: (publicKey) => set({ activeConversation: publicKey }),

  clearConversation: (publicKey) => {
    // Remove from local state
    set((state) => ({
      messages: (() => { const m = { ...state.messages }; delete m[publicKey]; return m; })(),
      conversations: state.conversations.filter((c) => c.publicKey !== publicKey),
      activeConversation: state.activeConversation === publicKey ? null : state.activeConversation,
    }));
    // Clear from IndexedDB
    const myKey = useNetworkStore.getState().publicKey;
    const channelKey = `dm:${[myKey, publicKey].sort().join(':')}`;
    dmDB.clearChannel(channelKey);
  },

  init: () => {
    const network = useNetworkStore.getState();
    const myKey = network.publicKey;

    const unsubscribe = network.onMessage((msg: TransportMessage) => {
      switch (msg.type) {
        case 'DM_MESSAGE': {
          const p = msg.payload as any;
          const otherKey = p.senderPublicKey === myKey ? p.recipientPublicKey : p.senderPublicKey;
          const dmMsg: DMMessage = { messageId: p.messageId, content: p.content, senderPublicKey: p.senderPublicKey, senderUsername: p.senderUsername, recipientPublicKey: p.recipientPublicKey, timestamp: p.timestamp, isOwn: p.senderPublicKey === myKey };
          set((state) => {
            const existing = state.messages[otherKey] || [];
            if (existing.some((m) => m.messageId === dmMsg.messageId)) return state;
            return { messages: { ...state.messages, [otherKey]: [...existing, dmMsg].sort((a, b) => a.timestamp - b.timestamp) } };
          });
          dmDB.addMessage({ messageId: p.messageId, channel: `dm:${[myKey, otherKey].sort().join(':')}`, content: p.content, senderPublicKey: p.senderPublicKey, senderUsername: p.senderUsername, timestamp: p.timestamp, signature: (msg as any).signature || '' });

          // Update conversation list with the new message
          set((state) => {
            const convs = [...state.conversations];
            const idx = convs.findIndex((c) => c.publicKey === otherKey);
            const otherName = p.senderPublicKey === myKey
              ? (p.recipientUsername || otherKey.slice(0, 8) + '...')
              : p.senderUsername;
            if (idx >= 0) {
              convs[idx] = { ...convs[idx], lastMessage: p.content, lastTimestamp: p.timestamp, username: otherName || convs[idx].username };
            } else {
              convs.unshift({ publicKey: otherKey, username: otherName, lastMessage: p.content, lastTimestamp: p.timestamp, unreadCount: 0 });
            }
            convs.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
            return { conversations: convs };
          });
          break;
        }

        case 'DM_HISTORY_RESPONSE': {
          const p = msg.payload as any;
          const msgs: DMMessage[] = (p.messages || []).map((m: any) => ({
            messageId: m.messageId, content: m.content, senderPublicKey: m.senderPublicKey,
            senderUsername: m.senderUsername, recipientPublicKey: m.recipientPublicKey,
            timestamp: m.timestamp, isOwn: m.senderPublicKey === myKey,
          }));
          set((state) => ({ messages: { ...state.messages, [p.otherPublicKey]: msgs } }));
          break;
        }

        case 'DM_CONVERSATIONS_RESPONSE': {
          const p = msg.payload as any;
          set({ conversations: p.conversations || [] });
          break;
        }
      }
    });

    return unsubscribe;
  },
}));

(window as any).__dm = useDMStore;
