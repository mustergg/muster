/**
 * Squad Store — R13
 *
 * Manages squads, members, and squad chat messages.
 */

import { create } from 'zustand';
import { useNetworkStore } from './networkStore';
import type { TransportMessage } from '@muster/transport';

export interface Squad {
  id: string;
  communityId: string;
  name: string;
  ownerPublicKey: string;
  ownerUsername: string;
  textChannelId: string;
  voiceChannelId: string;
  memberCount: number;
  createdAt: number;
}

export interface SquadMember {
  publicKey: string;
  username: string;
  role: string;
  joinedAt: number;
}

export interface SquadMessage {
  messageId: string;
  squadId: string;
  content: string;
  senderPublicKey: string;
  senderUsername: string;
  timestamp: number;
  isOwn: boolean;
}

interface SquadState {
  /** Squads keyed by communityId */
  squads: Record<string, Squad[]>;
  /** Members keyed by squadId */
  members: Record<string, SquadMember[]>;
  /** Messages keyed by squadId */
  messages: Record<string, SquadMessage[]>;
  /** Currently active squad */
  activeSquadId: string | null;
  lastMessage: string;
  loading: boolean;

  loadSquads: (communityId: string) => void;
  createSquad: (communityId: string, name: string) => void;
  deleteSquad: (squadId: string) => void;
  inviteMember: (squadId: string, username: string) => void;
  kickMember: (squadId: string, publicKey: string) => void;
  leaveSquad: (squadId: string) => void;
  loadMembers: (squadId: string) => void;
  openSquad: (squadId: string) => void;
  sendMessage: (squadId: string, content: string) => void;
  clearMessage: () => void;
  init: () => () => void;
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const useSquadStore = create<SquadState>((set, get) => ({
  squads: {},
  members: {},
  messages: {},
  activeSquadId: null,
  lastMessage: '',
  loading: false,

  loadSquads: (communityId: string) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'GET_SQUADS', payload: { communityId }, timestamp: Date.now() });
  },

  createSquad: (communityId: string, name: string) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    set({ loading: true });
    transport.send({ type: 'CREATE_SQUAD', payload: { communityId, name }, timestamp: Date.now() });
  },

  deleteSquad: (squadId: string) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'DELETE_SQUAD', payload: { squadId }, timestamp: Date.now() });
  },

  inviteMember: (squadId: string, username: string) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'INVITE_TO_SQUAD', payload: { squadId, targetUsername: username }, timestamp: Date.now() });
  },

  kickMember: (squadId: string, publicKey: string) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'KICK_FROM_SQUAD', payload: { squadId, publicKey }, timestamp: Date.now() });
  },

  leaveSquad: (squadId: string) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'LEAVE_SQUAD', payload: { squadId }, timestamp: Date.now() });
  },

  loadMembers: (squadId: string) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'GET_SQUAD_MEMBERS', payload: { squadId }, timestamp: Date.now() });
  },

  openSquad: (squadId: string) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    set({ activeSquadId: squadId });
    // Subscribe to squad channel for real-time messages
    transport.send({ type: 'SUBSCRIBE_SQUAD', payload: { squadId }, timestamp: Date.now() });
    // Load history
    transport.send({ type: 'SQUAD_HISTORY_REQUEST', payload: { squadId, since: 0 }, timestamp: Date.now() });
    // Load members
    get().loadMembers(squadId);
  },

  sendMessage: (squadId: string, content: string) => {
    const { transport, publicKey, username } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    const messageId = uuid();
    const timestamp = Date.now();

    // Optimistic update
    set((s) => ({
      messages: {
        ...s.messages,
        [squadId]: [...(s.messages[squadId] || []), { messageId, squadId, content, senderPublicKey: publicKey, senderUsername: username, timestamp, isOwn: true }],
      },
    }));

    transport.send({ type: 'SEND_SQUAD_MESSAGE', payload: { squadId, content, messageId }, timestamp: Date.now() });
  },

  clearMessage: () => set({ lastMessage: '' }),

  init: () => {
    const myKey = useNetworkStore.getState().publicKey;

    const unsubscribe = useNetworkStore.getState().onMessage((msg: TransportMessage) => {
      switch (msg.type) {
        case 'SQUAD_LIST': {
          const p = msg.payload as any;
          set((s) => ({ squads: { ...s.squads, [p.communityId]: p.squads || [] } }));
          break;
        }
        case 'SQUAD_CREATED': {
          const p = msg.payload as any;
          set((s) => {
            const list = s.squads[p.communityId] || [];
            if (list.some((sq) => sq.id === p.id)) return s;
            return { squads: { ...s.squads, [p.communityId]: [...list, p] }, loading: false };
          });
          break;
        }
        case 'SQUAD_DELETED': {
          const p = msg.payload as any;
          set((s) => {
            const updated: Record<string, Squad[]> = {};
            for (const [cid, list] of Object.entries(s.squads)) {
              updated[cid] = list.filter((sq) => sq.id !== p.squadId);
            }
            return {
              squads: updated,
              activeSquadId: s.activeSquadId === p.squadId ? null : s.activeSquadId,
            };
          });
          break;
        }
        case 'SQUAD_MEMBER_LIST': {
          const p = msg.payload as any;
          set((s) => ({ members: { ...s.members, [p.squadId]: p.members || [] } }));
          break;
        }
        case 'SQUAD_MEMBER_JOINED': {
          const p = msg.payload as any;
          set((s) => {
            const existing = s.members[p.squadId] || [];
            if (existing.some((m) => m.publicKey === p.member.publicKey)) return s;
            return { members: { ...s.members, [p.squadId]: [...existing, p.member] } };
          });
          break;
        }
        case 'SQUAD_MEMBER_LEFT': {
          const p = msg.payload as any;
          set((s) => ({
            members: { ...s.members, [p.squadId]: (s.members[p.squadId] || []).filter((m) => m.publicKey !== p.publicKey) },
          }));
          break;
        }
        case 'SQUAD_MESSAGE': {
          const p = msg.payload as any;
          const squadMsg: SquadMessage = { ...p, isOwn: p.senderPublicKey === myKey };
          set((s) => {
            const existing = s.messages[p.squadId] || [];
            if (existing.some((m) => m.messageId === p.messageId)) return s;
            return { messages: { ...s.messages, [p.squadId]: [...existing, squadMsg].sort((a, b) => a.timestamp - b.timestamp) } };
          });
          break;
        }
        case 'SQUAD_HISTORY_RESPONSE': {
          const p = msg.payload as any;
          const msgs: SquadMessage[] = (p.messages || []).map((m: any) => ({ ...m, squadId: p.squadId, isOwn: m.senderPublicKey === myKey }));
          set((s) => ({ messages: { ...s.messages, [p.squadId]: msgs } }));
          break;
        }
        case 'SQUAD_RESULT': {
          const p = msg.payload as any;
          set({ loading: false, lastMessage: p.message || '' });
          break;
        }
      }
    });

    return unsubscribe;
  },
}));

(window as any).__squads = useSquadStore;
