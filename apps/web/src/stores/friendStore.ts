/**
 * Friend Store — R11
 *
 * Manages friends, friend requests, and blocked users.
 * Subscribes to transport messages for real-time updates.
 */

import { create } from 'zustand';
import { useNetworkStore } from './networkStore';
import type { TransportMessage } from '@muster/transport';

export interface Friend {
  publicKey: string;
  username: string;
  displayName: string;
  since: number;
}

export interface FriendRequest {
  id: string;
  fromPublicKey: string;
  fromUsername: string;
  toPublicKey: string;
  toUsername: string;
  status: string;
  createdAt: number;
}

export interface BlockedUser {
  blockerPublicKey: string;
  blockedPublicKey: string;
  blockedUsername: string;
  blockedAt: number;
}

interface FriendState {
  friends: Friend[];
  incomingRequests: FriendRequest[];
  outgoingRequests: FriendRequest[];
  blockedUsers: BlockedUser[];
  lastMessage: string;
  loading: boolean;

  // Actions
  loadFriends: () => void;
  loadRequests: () => void;
  loadBlocked: () => void;
  sendRequest: (username: string) => void;
  respondRequest: (requestId: string, action: 'accept' | 'decline' | 'block') => void;
  cancelRequest: (requestId: string) => void;
  removeFriend: (publicKey: string) => void;
  blockUser: (publicKey: string) => void;
  unblockUser: (publicKey: string) => void;
  clearMessage: () => void;
  init: () => () => void;
}

export const useFriendStore = create<FriendState>((set, get) => ({
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  blockedUsers: [],
  lastMessage: '',
  loading: false,

  loadFriends: () => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'GET_FRIENDS', payload: {}, timestamp: Date.now() });
  },

  loadRequests: () => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'GET_FRIEND_REQUESTS', payload: {}, timestamp: Date.now() });
  },

  loadBlocked: () => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'GET_BLOCKED_USERS', payload: {}, timestamp: Date.now() });
  },

  sendRequest: (username: string) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    set({ loading: true });
    transport.send({ type: 'SEND_FRIEND_REQUEST', payload: { targetUsername: username.trim() }, timestamp: Date.now() });
  },

  respondRequest: (requestId: string, action: 'accept' | 'decline' | 'block') => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'RESPOND_FRIEND_REQUEST', payload: { requestId, action }, timestamp: Date.now() });
  },

  cancelRequest: (requestId: string) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'CANCEL_FRIEND_REQUEST', payload: { requestId }, timestamp: Date.now() });
  },

  removeFriend: (publicKey: string) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'REMOVE_FRIEND', payload: { publicKey }, timestamp: Date.now() });
  },

  blockUser: (publicKey: string) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'BLOCK_USER', payload: { publicKey }, timestamp: Date.now() });
  },

  unblockUser: (publicKey: string) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'UNBLOCK_USER', payload: { publicKey }, timestamp: Date.now() });
  },

  clearMessage: () => set({ lastMessage: '' }),

  init: () => {
    const unsubscribe = useNetworkStore.getState().onMessage((msg: TransportMessage) => {
      switch (msg.type) {
        case 'FRIEND_LIST': {
          const p = msg.payload as any;
          set({ friends: p.friends || [] });
          break;
        }
        case 'FRIEND_REQUEST_LIST': {
          const p = msg.payload as any;
          set({ incomingRequests: p.incoming || [], outgoingRequests: p.outgoing || [] });
          break;
        }
        case 'BLOCKED_USERS_LIST': {
          const p = msg.payload as any;
          set({ blockedUsers: p.users || [] });
          break;
        }
        case 'FRIEND_REQUEST_RECEIVED': {
          const p = msg.payload as any;
          set((s) => ({
            incomingRequests: [...s.incomingRequests, p],
            lastMessage: `Friend request from ${p.fromUsername}!`,
          }));
          break;
        }
        case 'FRIEND_ADDED': {
          const p = msg.payload as any;
          set((s) => ({
            friends: [...s.friends.filter((f) => f.publicKey !== p.publicKey), p],
            incomingRequests: s.incomingRequests.filter((r) =>
              r.fromPublicKey !== p.publicKey && r.toPublicKey !== p.publicKey
            ),
            outgoingRequests: s.outgoingRequests.filter((r) =>
              r.fromPublicKey !== p.publicKey && r.toPublicKey !== p.publicKey
            ),
          }));
          break;
        }
        case 'FRIEND_REQUEST_CANCELLED': {
          const p = msg.payload as any;
          set((s) => ({
            incomingRequests: s.incomingRequests.filter((r) => r.id !== p.requestId),
          }));
          break;
        }
        case 'FRIEND_REMOVED': {
          const p = msg.payload as any;
          set((s) => ({
            friends: s.friends.filter((f) => f.publicKey !== p.publicKey),
          }));
          break;
        }
        case 'FRIEND_RESULT': {
          const p = msg.payload as any;
          set({ loading: false, lastMessage: p.message || '' });
          // Reload data after successful actions
          if (p.success) {
            setTimeout(() => {
              get().loadFriends();
              get().loadRequests();
              get().loadBlocked();
            }, 200);
          }
          break;
        }
      }
    });

    // Initial load
    get().loadFriends();
    get().loadRequests();
    get().loadBlocked();

    return unsubscribe;
  },
}));

(window as any).__friends = useFriendStore;
