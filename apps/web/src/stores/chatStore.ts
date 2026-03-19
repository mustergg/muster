/**
 * Chat store — messages with localStorage persistence.
 * OrbitDB sync is best-effort and non-blocking.
 */

import { create } from 'zustand';
import { subscribe, publish, communityChannelTopic } from '@muster/core';
import { generateId, now, type TextMessage, type MusterMessage } from '@muster/protocol';
import { useNetworkStore } from './networkStore.js';
import { useAuthStore } from './authStore.js';
import { useDBStore } from './dbStore.js';

export interface StoredMessage {
  id: string;
  channelId: string;
  communityId: string;
  senderPublicKeyHex: string;
  senderUsername: string;
  content: string;
  ts: number;
  deleted?: boolean;
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

const LS_KEY = (communityId: string, channelId: string) =>
  `muster:messages:${communityId}:${channelId}`;

const MAX_STORED = 200; // max messages kept per channel in localStorage

function lsLoadMessages(communityId: string, channelId: string): StoredMessage[] {
  try {
    const raw = localStorage.getItem(LS_KEY(communityId, channelId));
    return raw ? (JSON.parse(raw) as StoredMessage[]) : [];
  } catch { return []; }
}

function lsSaveMessages(communityId: string, channelId: string, messages: StoredMessage[]): void {
  try {
    // Keep only the latest MAX_STORED messages
    const trimmed = messages.slice(-MAX_STORED);
    localStorage.setItem(LS_KEY(communityId, channelId), JSON.stringify(trimmed));
  } catch {}
}

// ─── Store ────────────────────────────────────────────────────────────────────

type ChannelMessages = Record<string, StoredMessage[]>;
type Unsubscribers   = Record<string, () => void>;

interface ChatState {
  messages:       ChannelMessages;
  knownPeers:     Record<string, string>;
  _unsubscribers: Unsubscribers;

  joinChannel:  (communityId: string, channelId: string) => void;
  leaveChannel: (communityId: string, channelId: string) => void;
  sendMessage:  (communityId: string, channelId: string, content: string) => Promise<void>;
}

export const useChatStore = create<ChatState>()((set, get) => ({
  messages:       {},
  knownPeers:     {},
  _unsubscribers: {},

  joinChannel: (communityId, channelId) => {
    const key = `${communityId}:${channelId}`;
    if (get()._unsubscribers[key]) return;

    // Load from localStorage immediately — no async, always works
    const history = lsLoadMessages(communityId, channelId);
    set((state) => ({
      messages: { ...state.messages, [channelId]: history },
    }));

    // Subscribe to GossipSub for real-time messages
    const { node } = useNetworkStore.getState();
    if (!node) {
      set((state) => ({
        _unsubscribers: { ...state._unsubscribers, [key]: () => {} },
      }));
      return;
    }

    const topic = communityChannelTopic(communityId, channelId);

    const unsub = subscribe(node, topic, (message: MusterMessage, senderPublicKeyHex: string) => {
      if (message.type !== 'chat.text') return;
      const textMsg = message as TextMessage;

      // Avoid duplicates
      const existing = get().messages[channelId] ?? [];
      if (existing.some((m) => m.id === textMsg.id)) return;

      const stored: StoredMessage = {
        id:                 textMsg.id,
        channelId:          textMsg.channelId,
        communityId:        textMsg.communityId,
        senderPublicKeyHex,
        senderUsername:     get().knownPeers[senderPublicKeyHex] ?? senderPublicKeyHex.slice(0, 10),
        content:            textMsg.content,
        ts:                 textMsg.ts,
      };

      set((state) => {
        const updated = [...(state.messages[channelId] ?? []), stored];
        lsSaveMessages(communityId, channelId, updated);
        return { messages: { ...state.messages, [channelId]: updated } };
      });

      // Also try OrbitDB in background
      const { db } = useDBStore.getState();
      if (db) {
        db.openMessageLog(communityId, channelId)
          .then((log) => log.add({ ...stored, signature: '' }))
          .catch(() => {});
      }
    });

    set((state) => ({
      _unsubscribers: { ...state._unsubscribers, [key]: unsub },
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
    const { _keypair, publicKeyHex, username } = useAuthStore.getState();
    if (!_keypair || !publicKeyHex || !username) throw new Error('Not authenticated');

    const stored: StoredMessage = {
      id:                 generateId(),
      channelId,
      communityId,
      senderPublicKeyHex: publicKeyHex,
      senderUsername:     username,
      content,
      ts:                 now(),
    };

    // Save to localStorage immediately
    set((state) => {
      const updated = [...(state.messages[channelId] ?? []), stored];
      lsSaveMessages(communityId, channelId, updated);
      return { messages: { ...state.messages, [channelId]: updated } };
    });

    // Publish via GossipSub
    const { node } = useNetworkStore.getState();
    if (node && _keypair) {
      const message: TextMessage = {
        v:                  1,
        id:                 stored.id,
        ts:                 stored.ts,
        type:               'chat.text',
        senderPublicKeyHex: publicKeyHex,
        communityId,
        channelId,
        content,
      };
      await publish(node, communityChannelTopic(communityId, channelId), message, _keypair);
    }

    // Also try OrbitDB in background
    const { db } = useDBStore.getState();
    if (db) {
      db.openMessageLog(communityId, channelId)
        .then((log) => log.add({ ...stored, signature: '' }))
        .catch(() => {});
    }
  },
}));
