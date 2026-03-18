/**
 * Chat store — holds message history per channel and dispatches
 * incoming/outgoing messages through the P2P network.
 */

import { create } from 'zustand';
import {
  subscribe,
  publish,
  communityChannelTopic,
  communityPresenceTopic,
} from '@muster/core';
import { generateId, now, type TextMessage, type MusterMessage } from '@muster/protocol';
import { useNetworkStore } from './networkStore.js';
import { useAuthStore } from './authStore.js';

export interface StoredMessage {
  id: string;
  channelId: string;
  communityId: string;
  senderPublicKeyHex: string;
  senderUsername: string;
  content: string;
  ts: number;
  edited?: boolean;
  deleted?: boolean;
}

/** channelId → messages (newest last) */
type ChannelMessages = Record<string, StoredMessage[]>;

/** communityId:channelId → unsubscribe fn */
type Unsubscribers = Record<string, () => void>;

interface ChatState {
  messages: ChannelMessages;
  /** Map of publicKeyHex → username for peers we know about */
  knownPeers: Record<string, string>;
  _unsubscribers: Unsubscribers;

  /**
   * Subscribe to a channel's GossipSub topic.
   * Incoming messages are appended to messages[channelId].
   */
  joinChannel: (communityId: string, channelId: string) => void;

  /** Unsubscribe from a channel topic */
  leaveChannel: (communityId: string, channelId: string) => void;

  /**
   * Publish a text message to a channel.
   */
  sendMessage: (
    communityId: string,
    channelId: string,
    content: string,
  ) => Promise<void>;
}

export const useChatStore = create<ChatState>()((set, get) => ({
  messages:     {},
  knownPeers:   {},
  _unsubscribers: {},

  joinChannel: (communityId, channelId) => {
    const key = `${communityId}:${channelId}`;
    if (get()._unsubscribers[key]) return; // Already subscribed

    const { node } = useNetworkStore.getState();
    if (!node) {
      console.warn('[Chat] Cannot join channel — node not connected');
      return;
    }

    const topic = communityChannelTopic(communityId, channelId);

    const unsub = subscribe(node, topic, (message: MusterMessage, senderPublicKeyHex: string) => {
      if (message.type !== 'chat.text') return;
      const textMsg = message as TextMessage;

      const stored: StoredMessage = {
        id:                 textMsg.id,
        channelId:          textMsg.channelId,
        communityId:        textMsg.communityId,
        senderPublicKeyHex,
        senderUsername:     get().knownPeers[senderPublicKeyHex] ?? senderPublicKeyHex.slice(0, 10),
        content:            textMsg.content,
        ts:                 textMsg.ts,
      };

      set((state) => ({
        messages: {
          ...state.messages,
          [channelId]: [...(state.messages[channelId] ?? []), stored],
        },
      }));
    });

    set((state) => ({
      _unsubscribers: { ...state._unsubscribers, [key]: unsub },
      messages: { ...state.messages, [channelId]: state.messages[channelId] ?? [] },
    }));
  },

  leaveChannel: (communityId, channelId) => {
    const key = `${communityId}:${channelId}`;
    const unsub = get()._unsubscribers[key];
    if (unsub) {
      unsub();
      set((state) => {
        const updated = { ...state._unsubscribers };
        delete updated[key];
        return { _unsubscribers: updated };
      });
    }
  },

  sendMessage: async (communityId, channelId, content) => {
    const { node } = useNetworkStore.getState();
    const { _keypair, publicKeyHex, username } = useAuthStore.getState();

    if (!node)        throw new Error('Not connected to network');
    if (!_keypair)    throw new Error('Not authenticated');
    if (!publicKeyHex || !username) throw new Error('Missing user info');

    const message: TextMessage = {
      v:                  1,
      id:                 generateId(),
      ts:                 now(),
      type:               'chat.text',
      senderPublicKeyHex: publicKeyHex,
      communityId,
      channelId,
      content,
    };

    // Optimistic: add own message to local state immediately
    const stored: StoredMessage = {
      id:                 message.id,
      channelId,
      communityId,
      senderPublicKeyHex: publicKeyHex,
      senderUsername:     username,
      content,
      ts:                 message.ts,
    };

    set((state) => ({
      messages: {
        ...state.messages,
        [channelId]: [...(state.messages[channelId] ?? []), stored],
      },
    }));

    const topic = communityChannelTopic(communityId, channelId);
    await publish(node, topic, message, _keypair);
  },
}));
