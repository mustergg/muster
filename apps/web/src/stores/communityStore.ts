/**
 * Community store — manages real communities from OrbitDB.
 *
 * Handles: create, join via invite, list, channel list, member presence.
 */

import { create } from 'zustand';
import { generateId, now } from '@muster/protocol';
import type { StoredCommunity, StoredCommunityMember, StoredChannel } from '@muster/db';
import { useDBStore } from './dbStore.js';
import { useAuthStore } from './authStore.js';
import { useNetworkStore } from './networkStore.js';
import { communityPresenceTopic, subscribe, publish } from '@muster/core';
import type { MusterMessage } from '@muster/protocol';

// ─── Presence ────────────────────────────────────────────────────────────────

export interface OnlineMember {
  publicKeyHex: string;
  username: string;
  lastSeen: number;
}

// ─── Invite link format ───────────────────────────────────────────────────────
// muster://join/{communityId}/{inviteToken}
// In the web app we encode this as: ?join={communityId}:{inviteToken}

export function buildInviteLink(communityId: string, inviteToken: string): string {
  const base = window.location.origin;
  return `${base}?join=${communityId}:${inviteToken}`;
}

export function parseInviteLink(url: string): { communityId: string; inviteToken: string } | null {
  try {
    const u = new URL(url);
    const join = u.searchParams.get('join');
    if (!join) return null;
    const [communityId, inviteToken] = join.split(':');
    if (!communityId || !inviteToken) return null;
    return { communityId, inviteToken };
  } catch {
    return null;
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface CommunityState {
  /** All communities the user has joined, keyed by ID */
  communities: Record<string, StoredCommunity>;
  /** Online members per community, keyed by communityId */
  onlineMembers: Record<string, OnlineMember[]>;
  /** Active invite tokens per community (owner only) */
  inviteTokens: Record<string, string>;
  /** Loading state */
  loading: boolean;
  error: string | null;

  /** Load all joined communities from OrbitDB */
  loadCommunities: () => Promise<void>;

  /** Create a new community */
  createCommunity: (name: string, description?: string) => Promise<StoredCommunity>;

  /** Join a community via invite link or ID */
  joinCommunity: (communityId: string) => Promise<StoredCommunity>;

  /** Generate an invite link for a community */
  generateInvite: (communityId: string) => string;

  /** Subscribe to presence events for a community */
  subscribePresence: (communityId: string) => () => void;

  /** Announce own presence to a community */
  announcePresence: (communityId: string) => Promise<void>;
}

// Local storage key for joined community IDs
const JOINED_COMMUNITIES_KEY = 'muster:joined-communities';

function getJoinedCommunityIds(): string[] {
  try {
    const raw = localStorage.getItem(JOINED_COMMUNITIES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveJoinedCommunityIds(ids: string[]): void {
  localStorage.setItem(JOINED_COMMUNITIES_KEY, JSON.stringify(ids));
}

export const useCommunityStore = create<CommunityState>()((set, get) => ({
  communities:   {},
  onlineMembers: {},
  inviteTokens:  {},
  loading:       false,
  error:         null,

  loadCommunities: async () => {
    const { db } = useDBStore.getState();
    if (!db) return;

    set({ loading: true, error: null });
    const ids = getJoinedCommunityIds();
    const communities: Record<string, StoredCommunity> = {};

    for (const id of ids) {
      try {
        const store = await db.openCommunity(id);
        const meta  = await store.getMeta();
        if (meta) communities[id] = meta;
      } catch (err) {
        console.warn(`[Community] Failed to load community ${id}:`, err);
      }
    }

    set({ communities, loading: false });
  },

  createCommunity: async (name, description) => {
    const { db }           = useDBStore.getState();
    const { publicKeyHex, username } = useAuthStore.getState();
    if (!db || !publicKeyHex || !username) throw new Error('Not authenticated or DB not ready');

    const communityId = generateId();
    const ts          = now();

    // Default channels
    const defaultChannels: StoredChannel[] = [
      { id: generateId(), name: 'general',     type: 'text',  visibility: 'public', position: 0 },
      { id: generateId(), name: 'announcements', type: 'text', visibility: 'readonly', position: 1 },
    ];

    const community: StoredCommunity = {
      id:               communityId,
      name:             name.trim(),
      description:      description?.trim(),
      type:             'public',
      ownerPublicKeyHex: publicKeyHex,
      channels:         defaultChannels,
      categories:       [],
      hostNodePeerIds:  [],
      createdAt:        ts,
      updatedAt:        ts,
      version:          1,
    };

    // Save to OrbitDB
    const store = await db.openCommunity(communityId);
    await store.setMeta(community);

    // Add self as owner member
    const member: StoredCommunityMember = {
      publicKeyHex,
      username,
      role:          'owner',
      customRoleIds: [],
      joinedAt:      ts,
    };
    await store.setMember(member);

    // Save to local joined list
    const ids = getJoinedCommunityIds();
    if (!ids.includes(communityId)) {
      saveJoinedCommunityIds([...ids, communityId]);
    }

    set((state) => ({
      communities: { ...state.communities, [communityId]: community },
    }));

    return community;
  },

  joinCommunity: async (communityId) => {
    const { db }           = useDBStore.getState();
    const { publicKeyHex, username } = useAuthStore.getState();
    if (!db || !publicKeyHex || !username) throw new Error('Not authenticated or DB not ready');

    // Check if already joined
    if (get().communities[communityId]) {
      return get().communities[communityId]!;
    }

    // Open the community store — OrbitDB will sync with peers who have it
    const store = await db.openCommunity(communityId);

    // Wait briefly for sync
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const meta = await store.getMeta();
    if (!meta) throw new Error('Community not found — make sure the invite link is correct and the creator is online');

    // Add self as member
    const member: StoredCommunityMember = {
      publicKeyHex,
      username,
      role:          'member',
      customRoleIds: [],
      joinedAt:      now(),
    };
    await store.setMember(member);

    // Save to local joined list
    const ids = getJoinedCommunityIds();
    if (!ids.includes(communityId)) {
      saveJoinedCommunityIds([...ids, communityId]);
    }

    set((state) => ({
      communities: { ...state.communities, [communityId]: meta },
    }));

    return meta;
  },

  generateInvite: (communityId) => {
    const token = generateId().replace(/-/g, '').slice(0, 12).toUpperCase();
    set((state) => ({
      inviteTokens: { ...state.inviteTokens, [communityId]: token },
    }));
    return buildInviteLink(communityId, token);
  },

  subscribePresence: (communityId) => {
    const { node } = useNetworkStore.getState();
    if (!node) return () => {};

    const topic = communityPresenceTopic(communityId);

    const unsub = subscribe(node, topic, (message: MusterMessage, senderPublicKeyHex: string) => {
      if (message.type !== 'peer.announce') return;
      const entry: OnlineMember = {
        publicKeyHex: senderPublicKeyHex,
        username:     (message as any).username ?? senderPublicKeyHex.slice(0, 10),
        lastSeen:     Date.now(),
      };

      set((state) => {
        const current = state.onlineMembers[communityId] ?? [];
        const filtered = current.filter((m) => m.publicKeyHex !== senderPublicKeyHex);
        return {
          onlineMembers: {
            ...state.onlineMembers,
            [communityId]: [...filtered, entry],
          },
        };
      });
    });

    // Announce own presence immediately
    get().announcePresence(communityId);

    // Announce every 30 seconds
    const interval = setInterval(() => get().announcePresence(communityId), 30_000);

    return () => {
      unsub();
      clearInterval(interval);
    };
  },

  announcePresence: async (communityId) => {
    const { node }           = useNetworkStore.getState();
    const { _keypair, publicKeyHex, username } = useAuthStore.getState();
    if (!node || !_keypair || !publicKeyHex || !username) return;

    const message = {
      v:                  1 as const,
      id:                 generateId(),
      ts:                 now(),
      type:               'peer.announce' as const,
      senderPublicKeyHex: publicKeyHex,
      communityId,
      username,
    };

    try {
      await publish(node, communityPresenceTopic(communityId), message as any, _keypair);
    } catch {
      // Non-fatal — presence is best-effort
    }
  },
}));
