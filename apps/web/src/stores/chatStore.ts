/**
 * Chat Store — manages channel messages via the relay node.
 *
 * REPLACES the old chatStore.ts (which used OrbitDB/GossipSub).
 * This version uses WebSocket pub/sub through the transport layer.
 *
 * How it works:
 * 1. Client subscribes to channels via SUBSCRIBE message
 * 2. To send: client signs and sends PUBLISH message
 * 3. Relay verifies signature and fans out MESSAGE to all subscribers
 * 4. Incoming MESSAGE events are added to the local message list
 */

import { create } from 'zustand';
import { useNetworkStore } from './networkStore';
import type { TransportMessage } from '@muster/transport';

// -----------------------------------------------------------------
// NOTE: Adjust this import to match your @muster/crypto package.
// -----------------------------------------------------------------
// import { sign } from '@muster/crypto';

// TEMPORARY stub — replace with real crypto
function sign(message: string, _privateKey: string): string {
  return 'stub-signature-' + message.slice(0, 8);
}

// Simple UUID v4 generator (no dependency needed)
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
  /** Whether this message was sent by the current user. */
  isOwn: boolean;
}

export interface PresenceUser {
  publicKey: string;
  username: string;
  status: string;
}

interface ChatState {
  /** Messages by channel: channelId → messages (sorted by timestamp). */
  messages: Record<string, ChatMessage[]>;

  /** Online users by channel: channelId → users. */
  presence: Record<string, PresenceUser[]>;

  /** Currently selected channel ID. */
  activeChannel: string | null;

  /** Subscribe to one or more channels. */
  subscribe: (channels: string[]) => void;

  /** Unsubscribe from channels. */
  unsubscribe: (channels: string[]) => void;

  /** Send a message to a channel. */
  sendMessage: (channel: string, content: string) => void;

  /** Set the active channel. */
  setActiveChannel: (channelId: string | null) => void;

  /** Clear all messages (e.g. on logout). */
  clear: () => void;

  /** Initialize the store — call once after network connects. */
  init: () => () => void;
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
    transport.send({
      type: 'SUBSCRIBE',
      payload: { channels: channelIds },
      timestamp: Date.now(),
    });
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

    // Sign the payload
    // TODO: Get privateKey from auth store — for now using publicKey as stub
    const signature = sign(JSON.stringify(payload), network.publicKey);

    // Send to relay
    network.transport.send({
      type: 'PUBLISH',
      payload,
      timestamp,
      signature,
      senderPublicKey: network.publicKey,
    });

    // Add to local messages immediately (optimistic update)
    const msg: ChatMessage = {
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
        [channel]: [...(state.messages[channel] || []), msg],
      },
    }));
  },

  setActiveChannel: (channelId) => {
    set({ activeChannel: channelId });
  },

  clear: () => {
    set({ messages: {}, presence: {}, activeChannel: null });
  },

  /**
   * Initialize the chat store by listening for incoming messages.
   * Call this once after the network connects.
   * Returns a cleanup function to call on unmount/logout.
   */
  init: () => {
    const network = useNetworkStore.getState();

    const unsubscribe = network.onMessage((msg: TransportMessage) => {
      switch (msg.type) {
        case 'MESSAGE': {
          const p = msg.payload as any;
          const myKey = useNetworkStore.getState().publicKey;

          const chatMsg: ChatMessage = {
            messageId: p.messageId,
            channel: p.channel,
            content: p.content,
            senderPublicKey: p.senderPublicKey,
            senderUsername: p.senderUsername,
            timestamp: p.timestamp,
            isOwn: p.senderPublicKey === myKey,
          };

          // Don't add duplicates (optimistic update already added own messages)
          set((state) => {
            const existing = state.messages[p.channel] || [];
            if (existing.some((m) => m.messageId === chatMsg.messageId)) {
              return state; // Already have this message
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
