/**
 * Community Store — R7
 *
 * Changes from R3:
 * - Added channel management: createChannel, editChannel, deleteChannel
 * - Added myRoles tracking (current user's role per community)
 * - Handles CHANNEL_CREATED, CHANNEL_UPDATED, CHANNEL_DELETED_EVENT, CHANNELS_REORDERED
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
  const urlMatch = url.match(/\/invite\/([a-f0-9-]+)/i);
  if (urlMatch) return urlMatch[1];
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
  /** Current user's role in each community (populated from COMMUNITY_DATA). */
  myRoles: Record<string, string>;

  loadCommunities: () => void;
  createCommunity: (name: string, description?: string) => Promise<StoredCommunity>;
  joinCommunity: (communityId: string) => Promise<StoredCommunity>;
  generateInvite: (communityId: string) => string;
  subscribePresence: (communityId: string) => () => void;
  announcePresence: (communityId: string) => Promise<void>;
  serveCommunityRequests: (communityId: string) => () => void;
  leaveCommunity: (communityId: string) => void;

  // Channel management — R7
  createChannel: (communityId: string, name: string, type?: string, visibility?: string) => Promise<void>;
  editChannel: (communityId: string, channelId: string, name?: string, visibility?: string) => Promise<void>;
  deleteChannel: (communityId: string, channelId: string) => Promise<void>;

  /** Internal: initialize relay message listener. Called by MainLayout. */
  initRelay: () => () => void;
}

// =================================================================
// Store
// =================================================================

export const useCommunityStore = create<CommunityState>()((set, get) => {
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
        const members = (msg.payload as any).members as Array<{ publicKey: string; username: string; role: string }>;

        // Track current user's role
        const myKey = useNetworkStore.getState().publicKey;
        const myMember = members?.find((m) => m.publicKey === myKey);

        set((state) => {
          const updated = { ...state.communities, [community.id]: community };
          saveToLocalStorage(updated);
          return {
            communities: updated,
            myRoles: myMember
              ? { ...state.myRoles, [community.id]: myMember.role }
              : state.myRoles,
          };
        });

        // Resolve pending create promises (relay responds with COMMUNITY_DATA, not COMMUNITY_CREATED)
        for (const [key, pending] of pendingCreates) {
          pending.resolve(community);
          pendingCreates.delete(key);
          break; // Only one create at a time
        }

        // Resolve pending join promises
        const pendingJoin = pendingJoins.get(community.id);
        if (pendingJoin) {
          pendingJoin.resolve(community);
          pendingJoins.delete(community.id);
        }

        break;
      }

      case 'COMMUNITY_LEFT': {
        const communityId = (msg.payload as any).communityId as string;
        set((state) => {
          const updated = { ...state.communities };
          delete updated[communityId];
          saveToLocalStorage(updated);
          const roles = { ...state.myRoles };
          delete roles[communityId];
          return { communities: updated, myRoles: roles };
        });
        break;
      }

      // ─── Ownership events (R8) ──────────────────────────────────

      case 'OWNERSHIP_TRANSFERRED': {
        const p = msg.payload as any;
        const { communityId, newOwnerPublicKey, previousOwnerPublicKey } = p;
        const myKey = useNetworkStore.getState().publicKey;

        set((state) => {
          const community = state.communities[communityId];
          if (!community) return state;

          // Update community owner
          const updated = {
            ...state.communities,
            [communityId]: { ...community, ownerPublicKey: newOwnerPublicKey },
          };
          saveToLocalStorage(updated);

          // Update roles
          const roles = { ...state.myRoles };
          if (myKey === newOwnerPublicKey) roles[communityId] = 'owner';
          if (myKey === previousOwnerPublicKey) roles[communityId] = 'admin';

          return { communities: updated, myRoles: roles };
        });
        break;
      }

      case 'COMMUNITY_DELETED': {
        const p = msg.payload as any;
        const communityId = p.communityId as string;
        set((state) => {
          const updated = { ...state.communities };
          delete updated[communityId];
          saveToLocalStorage(updated);
          const roles = { ...state.myRoles };
          delete roles[communityId];
          return { communities: updated, myRoles: roles };
        });
        break;
      }

      case 'COMMUNITY_MEMBER_UPDATE': {
        const p = msg.payload as any;
        const communityId = p.communityId;
        const members = p.members as Array<{ publicKey: string; username: string; role: string }>;

        // Update role if our role changed
        const myKey = useNetworkStore.getState().publicKey;
        const myMember = members?.find((m) => m.publicKey === myKey);
        if (myMember) {
          set((state) => ({
            myRoles: { ...state.myRoles, [communityId]: myMember.role },
          }));
        }
        break;
      }

      case 'ROLE_UPDATED': {
        const p = msg.payload as any;
        const myKey = useNetworkStore.getState().publicKey;
        if (p.targetPublicKey === myKey) {
          set((state) => ({
            myRoles: { ...state.myRoles, [p.communityId]: p.newRole },
          }));
        }
        break;
      }

      // ─── Channel management events (R7) ──────────────────────────

      case 'CHANNEL_CREATED': {
        const p = msg.payload as any;
        const { communityId, channel } = p;
        set((state) => {
          const community = state.communities[communityId];
          if (!community) return state;
          const updatedChannels = [...(community.channels || []), channel];
          updatedChannels.sort((a: any, b: any) => a.position - b.position);
          const updated = { ...state.communities, [communityId]: { ...community, channels: updatedChannels } };
          saveToLocalStorage(updated);
          return { communities: updated };
        });
        break;
      }

      case 'CHANNEL_UPDATED': {
        const p = msg.payload as any;
        const { communityId, channel } = p;
        set((state) => {
          const community = state.communities[communityId];
          if (!community) return state;
          const updatedChannels = (community.channels || []).map((ch: any) =>
            ch.id === channel.id ? { ...ch, name: channel.name, visibility: channel.visibility } : ch
          );
          const updated = { ...state.communities, [communityId]: { ...community, channels: updatedChannels } };
          saveToLocalStorage(updated);
          return { communities: updated };
        });
        break;
      }

      case 'CHANNEL_DELETED_EVENT': {
        const p = msg.payload as any;
        const { communityId, channelId } = p;
        set((state) => {
          const community = state.communities[communityId];
          if (!community) return state;
          const updatedChannels = (community.channels || []).filter((ch: any) => ch.id !== channelId);
          const updated = { ...state.communities, [communityId]: { ...community, channels: updatedChannels } };
          saveToLocalStorage(updated);
          return { communities: updated };
        });
        break;
      }

      case 'CHANNELS_REORDERED': {
        const p = msg.payload as any;
        const { communityId, channels: reorderedChannels } = p;
        set((state) => {
          const community = state.communities[communityId];
          if (!community) return state;
          const updated = { ...state.communities, [communityId]: { ...community, channels: reorderedChannels } };
          saveToLocalStorage(updated);
          return { communities: updated };
        });
        break;
      }

      case 'PRESENCE': {
        const p = msg.payload as any;
        const channelId = p.channel;
        const users = p.users || [];

        const communities = get().communities;
        let communityId = channelId;
        for (const [cid, community] of Object.entries(communities)) {
          if (community.channels?.some((ch: any) => ch.id === channelId)) {
            communityId = cid;
            break;
          }
        }

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
    myRoles: {},

    loadCommunities: () => {
      const cached = loadFromLocalStorage();
      set({ communities: cached });

      const { transport } = useNetworkStore.getState();
      if (transport?.isConnected) {
        transport.send({ type: 'LIST_COMMUNITIES', payload: {}, timestamp: Date.now() });
      }
    },

    createCommunity: (name, description) => {
      return new Promise<StoredCommunity>((resolve, reject) => {
        const { transport } = useNetworkStore.getState();
        if (!transport?.isConnected) { reject(new Error('Not connected to relay')); return; }

        const requestId = Math.random().toString(36).slice(2);
        pendingCreates.set(requestId, { resolve, reject });
        transport.send({ type: 'CREATE_COMMUNITY', payload: { name, description }, timestamp: Date.now() });
        setTimeout(() => { if (pendingCreates.has(requestId)) { pendingCreates.delete(requestId); reject(new Error('Create community timed out')); } }, 10000);
      });
    },

    joinCommunity: (communityId) => {
      return new Promise<StoredCommunity>((resolve, reject) => {
        const { transport } = useNetworkStore.getState();
        if (!transport?.isConnected) { reject(new Error('Not connected to relay')); return; }

        pendingJoins.set(communityId, { resolve, reject });
        transport.send({ type: 'JOIN_COMMUNITY', payload: { communityId }, timestamp: Date.now() });
        setTimeout(() => { if (pendingJoins.has(communityId)) { pendingJoins.delete(communityId); reject(new Error('Join community timed out')); } }, 10000);
      });
    },

    leaveCommunity: (communityId: string) => {
      const { transport } = useNetworkStore.getState();
      if (transport?.isConnected) {
        transport.send({ type: 'LEAVE_COMMUNITY', payload: { communityId }, timestamp: Date.now() });
      }
      const updated = { ...get().communities };
      delete updated[communityId];
      set({ communities: updated });
      saveToLocalStorage(updated);
    },

    generateInvite: (communityId) => buildInviteLink(communityId),

    // ─── Channel management — R7 ───────────────────────────────────

    createChannel: async (communityId, name, type, visibility) => {
      const { transport } = useNetworkStore.getState();
      if (!transport?.isConnected) throw new Error('Not connected to relay');
      transport.send({
        type: 'CREATE_CHANNEL',
        payload: { communityId, name, type: type || 'text', visibility: visibility || 'public' },
        timestamp: Date.now(),
      });
    },

    editChannel: async (communityId, channelId, name, visibility) => {
      const { transport } = useNetworkStore.getState();
      if (!transport?.isConnected) throw new Error('Not connected to relay');
      transport.send({
        type: 'EDIT_CHANNEL',
        payload: { communityId, channelId, name, visibility },
        timestamp: Date.now(),
      });
    },

    deleteChannel: async (communityId, channelId) => {
      const { transport } = useNetworkStore.getState();
      if (!transport?.isConnected) throw new Error('Not connected to relay');
      transport.send({
        type: 'DELETE_CHANNEL_CMD',
        payload: { communityId, channelId },
        timestamp: Date.now(),
      });
    },

    subscribePresence: (communityId) => {
      const community = get().communities[communityId];
      if (!community) return () => {};
      const { transport } = useNetworkStore.getState();
      if (!transport?.isConnected) return () => {};

      const channelIds = community.channels.map((c) => c.id);
      transport.send({ type: 'SUBSCRIBE', payload: { channels: channelIds }, timestamp: Date.now() });

      return () => {
        if (transport?.isConnected) {
          transport.send({ type: 'UNSUBSCRIBE', payload: { channels: channelIds }, timestamp: Date.now() });
        }
      };
    },

    announcePresence: async (_communityId) => {},
    serveCommunityRequests: (_communityId) => () => {},

    initRelay: () => {
      if (messageHandlerRegistered) return () => {};
      messageHandlerRegistered = true;
      const network = useNetworkStore.getState();
      const unsubscribe = network.onMessage(handleRelayMessage);
      return () => { messageHandlerRegistered = false; unsubscribe(); };
    },
  };
});
(window as any).__community = useCommunityStore;
