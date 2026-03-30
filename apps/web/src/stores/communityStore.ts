/**
 * Community Store — R3
 *
 * REPLACES the old communityStore.ts (which used GossipSub + OrbitDB).
 * This version uses the WebSocket relay for all community operations.
 *
 * API is designed to match what existing UI components expect:
 * - GuildsSidebar:        communities, loadCommunities()
 * - CreateCommunityModal: createCommunity(name, desc?)
 * - JoinCommunityModal:   joinCommunity(communityId)
 * - InviteLinkModal:      generateInvite(communityId)
 * - ChannelsSidebar:      subscribePresence(), onlineMembers, serveCommunityRequests()
 */

import { create } from 'zustand';
import { useNetworkStore } from './networkStore';
import type { TransportMessage } from '@muster/transport';

// =================================================================
// Types (matching what UI components expect)
// =================================================================

export interface StoredChannel {
  id: string;
  name: string;
  type: 'text' | 'feed' | 'voice' | 'voice-temp';
  visibility: 'public' | 'private' | 'readonly' | 'archived';
  position: number;
}

export interface StoredCommunity {
  id: string;
  name: string;
  description: string;
  type: string;
  ownerPublicKey: string;
  ownerUsername: string;
  channels: StoredChannel[];
  createdAt: number;
  memberCount: number;
}

export interface OnlineMember {
  publicKey: string;
  username: string;
  status: string;
}

// =================================================================
// Invite link helpers (exported for JoinCommunityModal)
// =================================================================

export function buildInviteLink(communityId: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  return `${base}/invite/${communityId}`;
}

export function parseInviteLink(url: string): string | null {
  // Accept full URL: http://localhost:3000/invite/abc-123
  const urlMatch = url.match(/\/invite\/([a-f0-9-]+)/i);
  if (urlMatch) return urlMatch[1];
  // Accept bare community ID: abc-123-def-456
  if (/^[a-f0-9-]{20,}$/i.test(url.trim())) return url.trim();
  return null;
}

// =================================================================
// Local storage helpers
// =================================================================

const LS_KEY = 'muster-communities';

function saveToLocalStorage(communities: Record<string, StoredCommunity>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(communities));
  } catch { /* quota exceeded or private browsing */ }
}

function loadFromLocalStorage(): Record<string, StoredCommunity> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

// =================================================================
// Store interface
// =================================================================

interface CommunityState {
  communities: Record<string, StoredCommunity>;
  onlineMembers: Record<string, OnlineMember[]>;

  loadCommunities: () => void;
  createCommunity: (name: string, description?: string) => Promise<StoredCommunity>;
  joinCommunity: (communityId: string) => Promise<StoredCommunity>;
  generateInvite: (communityId: string) => string;
  subscribePresence: (communityId: string) => () => void;
  announcePresence: (communityId: string) => Promise<void>;
  serveCommunityRequests: (communityId: string) => () => void;
  leaveCommunity: (communityId: string) => void;

  /** Internal: initialize relay message listener. Called by MainLayout. */
  initRelay: () => () => void;
}

// =================================================================
// Store
// =================================================================

export const useCommunityStore = create<CommunityState>()((set, get) => {
  // Pending promise resolvers for request/response patterns
  const pendingCreates = new Map<string, { resolve: (c: StoredCommunity) => void; reject: (e: Error) => void }>();
  const pendingJoins = new Map<string, { resolve: (c: StoredCommunity) => void; reject: (e: Error) => void }>();
  let messageHandlerRegistered = false;

  function handleRelayMessage(msg: TransportMessage): void {
    switch (msg.type) {
      case 'COMMUNITY_CREATED': {
        const community = (msg.payload as any).community as StoredCommunity;
        set((state) => {
          const updated = { ...state.communities, [community.id]: community };
          saveToLocalStorage(updated);
          return { communities: updated };
        });
        // Resolve any pending create promise
        // We match by checking if there's a pending create (only one at a time typically)
        for (const [key, pending] of pendingCreates) {
          pending.resolve(community);
          pendingCreates.delete(key);
          break;
        }
        break;
      }

      case 'COMMUNITY_JOINED': {
        const community = (msg.payload as any).community as StoredCommunity;
        set((state) => {
          const updated = { ...state.communities, [community.id]: community };
          saveToLocalStorage(updated);
          return { communities: updated };
        });
        const pending = pendingJoins.get(community.id);
        if (pending) {
          pending.resolve(community);
          pendingJoins.delete(community.id);
        }
        break;
      }

      case 'COMMUNITIES_LIST': {
        const communities = (msg.payload as any).communities as StoredCommunity[];
        const record: Record<string, StoredCommunity> = {};
        for (const c of communities) record[c.id] = c;
        set({ communities: record });
        saveToLocalStorage(record);
        break;
      }

      case 'COMMUNITY_DATA': {
        const community = (msg.payload as any).community as StoredCommunity;
        set((state) => ({
          communities: { ...state.communities, [community.id]: community },
        }));
        break;
      }

      case 'COMMUNITY_LEFT': {
        const communityId = (msg.payload as any).communityId as string;
        set((state) => {
          const updated = { ...state.communities };
          delete updated[communityId];
          saveToLocalStorage(updated);
          return { communities: updated };
        });
        break;
      }

case 'PRESENCE': {
        const p = msg.payload as any;
        const channelId = p.channel;
        const users = p.users || [];

        // Find which community this channel belongs to
        const communities = get().communities;
        let communityId = channelId; // fallback to channel ID
        for (const [cid, community] of Object.entries(communities)) {
          if (community.channels?.some((ch: any) => ch.id === channelId)) {
            communityId = cid;
            break;
          }
        }

        // Aggregate: merge users from all channels of the same community
        set((state) => {
          const existing = state.onlineMembers[communityId] || [];
          const merged = new Map<string, any>();
          for (const u of existing) merged.set(u.publicKey, u);
          for (const u of users) merged.set(u.publicKey, u);
          return {
            onlineMembers: {
              ...state.onlineMembers,
              [communityId]: [...merged.values()],
            },
          };
        });
        break;
      }

      case 'ERROR': {
        const error = (msg.payload as any);
        console.warn('[community] Relay error:', error.message);
        // Reject any pending promises
        for (const [key, pending] of pendingCreates) {
          pending.reject(new Error(error.message));
          pendingCreates.delete(key);
        }
        for (const [key, pending] of pendingJoins) {
          pending.reject(new Error(error.message));
          pendingJoins.delete(key);
        }
        break;
      }
    }
  }

  return {
    communities: {},
    onlineMembers: {},

    loadCommunities: () => {
      // Load from localStorage first (instant, cached)
      const cached = loadFromLocalStorage();
      set({ communities: cached });

      // Then request fresh list from relay
      const { transport } = useNetworkStore.getState();
      if (transport?.isConnected) {
        transport.send({
          type: 'LIST_COMMUNITIES',
          payload: {},
          timestamp: Date.now(),
        });
      }
    },

    createCommunity: (name, description) => {
      return new Promise<StoredCommunity>((resolve, reject) => {
        const { transport } = useNetworkStore.getState();
        if (!transport?.isConnected) {
          reject(new Error('Not connected to relay'));
          return;
        }

        const requestId = Math.random().toString(36).slice(2);
        pendingCreates.set(requestId, { resolve, reject });

        transport.send({
          type: 'CREATE_COMMUNITY',
          payload: { name, description },
          timestamp: Date.now(),
        });

        // Timeout after 10 seconds
        setTimeout(() => {
          if (pendingCreates.has(requestId)) {
            pendingCreates.delete(requestId);
            reject(new Error('Create community timed out'));
          }
        }, 10000);
      });
    },

    joinCommunity: (communityId) => {
      return new Promise<StoredCommunity>((resolve, reject) => {
        const { transport } = useNetworkStore.getState();
        if (!transport?.isConnected) {
          reject(new Error('Not connected to relay'));
          return;
        }

        pendingJoins.set(communityId, { resolve, reject });

        transport.send({
          type: 'JOIN_COMMUNITY',
          payload: { communityId },
          timestamp: Date.now(),
        });

        setTimeout(() => {
          if (pendingJoins.has(communityId)) {
            pendingJoins.delete(communityId);
            reject(new Error('Join community timed out'));
          }
        }, 10000);
      });
    },

leaveCommunity: (communityId: string) => {
    const { transport } = useNetworkStore.getState();
    if (transport?.isConnected) {
      transport.send({ type: 'LEAVE_COMMUNITY', payload: { communityId }, timestamp: Date.now() });
    }
    // Remove locally
    const updated = { ...get().communities };
    delete updated[communityId];
    set({ communities: updated });
    saveToLocalStorage(updated);
  },
    generateInvite: (communityId) => {
      return buildInviteLink(communityId);
    },

    subscribePresence: (communityId) => {
      // Subscribe to all channels of this community for presence updates
      const community = get().communities[communityId];
      if (!community) return () => {};

      const { transport } = useNetworkStore.getState();
      if (!transport?.isConnected) return () => {};

      const channelIds = community.channels.map((c) => c.id);
      transport.send({
        type: 'SUBSCRIBE',
        payload: { channels: channelIds },
        timestamp: Date.now(),
      });

      return () => {
        // Cleanup: unsubscribe from presence channels
        if (transport?.isConnected) {
          transport.send({
            type: 'UNSUBSCRIBE',
            payload: { channels: channelIds },
            timestamp: Date.now(),
          });
        }
      };
    },

    announcePresence: async (_communityId) => {
      // In the relay model, presence is automatic — the relay knows
      // who is connected. This is a no-op but kept for API compatibility.
    },

    serveCommunityRequests: (_communityId) => {
      // In the relay model, community data is served by the relay, not
      // by peers. This is a no-op but kept for API compatibility.
      return () => {};
    },

    initRelay: () => {
      if (messageHandlerRegistered) return () => {};
      messageHandlerRegistered = true;

      const network = useNetworkStore.getState();
      const unsubscribe = network.onMessage(handleRelayMessage);

      return () => {
        messageHandlerRegistered = false;
        unsubscribe();
      };
    },
  };
});
(window as any).__community = useCommunityStore;