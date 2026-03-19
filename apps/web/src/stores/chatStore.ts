/**
 * Chat store — integrates GossipSub (real-time) with OrbitDB (persistence).
 *
 * Flow:
 *   Send:    sign → publish via GossipSub → persist to OrbitDB
 *   Receive: verify → display → persist to OrbitDB
 *   Open:    load history from OrbitDB → subscribe to GossipSub
 */

import { create } from 'zustand';
import {
  subscribe, publish, communityChannelTopic,
} from '@muster/core';
import { generateId, now, type TextMessage, type MusterMessage } from '@muster/protocol';
import type { StoredChatMessage } from '@muster/db';
import { useNetworkStore } from './networkStore.js';
import { useAuthStore } from './authStore.js';
import { useDBStore } from './dbStore.js';

export type { StoredChatMessage };

type ChannelMessages = Record<string, StoredChatMessage[]>;
type Unsubscribers   = Record<string, () => void>;

interface ChatState {
  messages:       ChannelMessages;
  knownPeers:     Record<string, string>;
  _unsubscribers: Unsubscribers;

  joinChannel:  (communityId: string, channelId: string) => Promise<void>;
  leaveChannel: (communityId: string, channelId: string) => void;
  sendMessage:  (communityId: string, channelId: string, content: string) => Promise<void>;
}

export const useChatStore = create<ChatState>()((set, get) => ({
  messages:       {},
  knownPeers:     {},
  _unsubscribers: {},

  joinChannel: async (communityId, channelId) => {
    const key = `${communityId}:${channelId}`;
    if (get()._unsubscribers[key]) return;

    const { node }  = useNetworkStore.getState();
    const { db }    = useDBStore.getState();

    // Load history from OrbitDB if available
    if (db) {
      try {
        const log      = await db.openMessageLog(communityId, channelId);
        const history  = log.all();
        if (history.length > 0) {
          set((state) => ({
            messages: { ...state.messages, [channelId]: history },
          }));
        }
      } catch (err) {
        console.warn('[Chat] Could not load history from OrbitDB:', err);
      }
    }

    if (!node) {
      set((state) => ({
        messages: { ...state.messages, [channelId]: state.messages[channelId] ?? [] },
      }));
      return;
    }

    const topic = communityChannelTopic(communityId, channelId);

    const unsub = subscribe(node, topic, async (message: MusterMessage, senderPublicKeyHex: string) => {
      if (message.type !== 'chat.text') return;
      const textMsg = message as TextMessage;

      const stored: StoredChatMessage = {
        id:                 textMsg.id,
        channelId:          textMsg.channelId,
        communityId:        textMsg.communityId,
        senderPublicKeyHex,
        senderUsername:     get().knownPeers[senderPublicKeyHex] ?? senderPublicKeyHex.slice(0, 10),
        content:            textMsg.content,
        ts:                 textMsg.ts,
        signature:          '',
      };

      // Avoid duplicate messages
      const existing = get().messages[channelId] ?? [];
      if (existing.some((m) => m.id === stored.id)) return;

      set((state) => ({
        messages: {
          ...state.messages,
          [channelId]: [...(state.messages[channelId] ?? []), stored],
        },
      }));

      // Persist to OrbitDB
      if (db) {
        try {
          await db.persistMessage(stored);
        } catch (err) {
          console.warn('[Chat] Failed to persist received message:', err);
        }
      }
    });

    set((state) => ({
      _unsubscribers: { ...state._unsubscribers, [key]: unsub },
      messages: { ...state.messages, [channelId]: state.messages[channelId] ?? [] },
    }));
  },

  leaveChannel: (communityId, channelId) => {
    const key   = `${communityId}:${channelId}`;
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
    const { node }                           = useNetworkStore.getState();
    const { _keypair, publicKeyHex, username } = useAuthStore.getState();
    const { db }                             = useDBStore.getState();

    if (!_keypair || !publicKeyHex || !username) throw new Error('Not authenticated');

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

    const stored: StoredChatMessage = {
      id:                 message.id,
      channelId,
      communityId,
      senderPublicKeyHex: publicKeyHex,
      senderUsername:     username,
      content,
      ts:                 message.ts,
      signature:          '',
    };

    // Optimistic update
    set((state) => ({
      messages: {
        ...state.messages,
        [channelId]: [...(state.messages[channelId] ?? []), stored],
      },
    }));

    // Persist to OrbitDB
    if (db) {
      try {
        await db.persistMessage(stored);
      } catch (err) {
        console.warn('[Chat] Failed to persist sent message:', err);
      }
    }

    // Publish via GossipSub
    if (node && _keypair) {
      const topic = communityChannelTopic(communityId, channelId);
      await publish(node, topic, message, _keypair);
    }
  },
}));
