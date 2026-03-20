/**
 * Community store — localStorage + GossipSub sync.
 * No OrbitDB in browser — communities sync via GossipSub directly.
 */

import { create } from 'zustand';
import { generateId, now } from '@muster/protocol';
import type { StoredCommunity, StoredCommunityMember, StoredChannel } from '@muster/db';
import { useDBStore } from './dbStore.js';
import { useAuthStore } from './authStore.js';
import { useNetworkStore } from './networkStore.js';
import { communityPresenceTopic, communityChannelTopic, subscribe, publish } from '@muster/core';
import type { MusterMessage } from '@muster/protocol';

// ─── localStorage helpers ─────────────────────────────────────────────────────

const LS_JOINED    = 'muster:joined-ids';
const LS_COMMUNITY = (id: string) => `muster:community:${id}`;

function lsGet<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') as T; }
  catch { return null; }
}
function lsSet(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function getJoinedIds(): string[] { return lsGet<string[]>(LS_JOINED) ?? []; }
function addJoinedId(id: string): void {
  const ids = getJoinedIds();
  if (!ids.includes(id)) lsSet(LS_JOINED, [...ids, id]);
}

// ─── Invite helpers ───────────────────────────────────────────────────────────

export function buildInviteLink(communityId: string): string {
  return `${window.location.origin}${window.location.pathname}?join=${communityId}`;
}

export function parseInviteLink(url: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get('join');
  } catch {
    if (/^[a-f0-9-]{36}$/i.test(url.trim())) return url.trim();
    return null;
  }
}

// ─── GossipSub topics for community sync ─────────────────────────────────────

const communityRequestTopic  = (id: string) => `muster/community/${id}/request`;
const communityResponseTopic = (id: string) => `muster/community/${id}/response`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OnlineMember {
  publicKeyHex: string;
  username: string;
  lastSeen: number;
}

interface CommunityState {
  communities:   Record<string, StoredCommunity>;
  onlineMembers: Record<string, OnlineMember[]>;
  loading:       boolean;
  error:         string | null;

  loadCommunities:   () => void;
  createCommunity:   (name: string, description?: string) => Promise<StoredCommunity>;
  joinCommunity:     (communityId: string) => Promise<StoredCommunity>;
  generateInvite:    (communityId: string) => string;
  subscribePresence: (communityId: string) => () => void;
  announcePresence:  (communityId: string) => Promise<void>;
  serveCommunityRequests: (communityId: string) => () => void;
}

export const useCommunityStore = create<CommunityState>()((set, get) => ({
  communities:   {},
  onlineMembers: {},
  loading:       false,
  error:         null,

  // ── Load from localStorage ─────────────────────────────────────────────────
  loadCommunities: () => {
    const ids = getJoinedIds();
    const communities: Record<string, StoredCommunity> = {};
    for (const id of ids) {
      const c = lsGet<StoredCommunity>(LS_COMMUNITY(id));
      if (c) communities[id] = c;
    }
    set({ communities });
  },

  // ── Create community ───────────────────────────────────────────────────────
  createCommunity: async (name, description) => {
    const { publicKeyHex, username } = useAuthStore.getState();
    if (!publicKeyHex || !username) throw new Error('Not authenticated');

    const communityId = generateId();
    const ts = now();

    const defaultChannels: StoredChannel[] = [
      { id: generateId(), name: 'general',       type: 'text', visibility: 'public',   position: 0 },
      { id: generateId(), name: 'announcements', type: 'text', visibility: 'readonly', position: 1 },
    ];

    const community: StoredCommunity = {
      id:                communityId,
      name:              name.trim(),
      description:       description?.trim(),
      type:              'public',
      ownerPublicKeyHex: publicKeyHex,
      channels:          defaultChannels,
      categories:        [],
      hostNodePeerIds:   [],
      createdAt:         ts,
      updatedAt:         ts,
      version:           1,
    };

    lsSet(LS_COMMUNITY(communityId), community);
    addJoinedId(communityId);
    set((state) => ({ communities: { ...state.communities, [communityId]: community } }));

    // Start serving requests for this community immediately
    get().serveCommunityRequests(communityId);

    return community;
  },

  // ── Serve community document to peers who request it ──────────────────────
  serveCommunityRequests: (communityId) => {
    const { node } = useNetworkStore.getState();
  if (!node) {
    console.log('[Community] No node available for serving requests');
    return () => {};
  }
  console.log('[Community] Serving requests for:', communityId);

    const requestTopic  = communityRequestTopic(communityId);
    const responseTopic = communityResponseTopic(communityId);

    const unsub = subscribe(node, requestTopic, async (message: MusterMessage) => {
      if (message.type !== 'community.request') return;

      const community = get().communities[communityId];
      if (!community) return;

      const { _keypair, publicKeyHex } = useAuthStore.getState();
      if (!_keypair || !publicKeyHex) return;

      await publish(node, responseTopic, {
        v:                  1 as const,
        id:                 generateId(),
        ts:                 now(),
        type:               'community.response' as const,
        senderPublicKeyHex: publicKeyHex,
        community,
      } as any, _keypair);
    });

    return unsub;
  },

  // ── Join via GossipSub ─────────────────────────────────────────────────────
  joinCommunity: async (communityId) => {
    const { publicKeyHex, username } = useAuthStore.getState();
    if (!publicKeyHex || !username) throw new Error('Not authenticated');

    if (get().communities[communityId]) return get().communities[communityId]!;

    const { node }    = useNetworkStore.getState();
    const { _keypair } = useAuthStore.getState();
    if (!node || !_keypair) throw new Error('Not connected to network');

    const requestTopic  = communityRequestTopic(communityId);
    const responseTopic = communityResponseTopic(communityId);

    return new Promise<StoredCommunity>((resolve, reject) => {
      let resolved = false;

      // Listen for community document response
      const unsub = subscribe(node, responseTopic, (message: MusterMessage) => {
        if (message.type !== 'community.response' || resolved) return;
        const community = (message as any).community as StoredCommunity;
        if (!community || community.id !== communityId) return;

        resolved = true;
        unsub();

        lsSet(LS_COMMUNITY(communityId), community);
        addJoinedId(communityId);
        set((state) => ({ communities: { ...state.communities, [communityId]: community } }));

        resolve(community);
      });

      // Send request every 2 seconds for up to 30 seconds
      let attempts = 0;
      const sendRequest = async (): Promise<void> => {
        if (resolved) return;
        if (attempts >= 15) {
          unsub();
          reject(new Error(
            'Community not found after 30 seconds.\n' +
            'Make sure:\n' +
            '• The community creator has the app open\n' +
            '• Both users are connected to the bootstrap node\n' +
            '• The invite link is correct'
          ));
          return;
        }
        attempts++;
		console.log('[Community] Sending request attempt', attempts, 'for:', communityId);
        try {
          await publish(node, requestTopic, {
            v:                  1 as const,
            id:                 generateId(),
            ts:                 now(),
            type:               'community.request' as const,
            senderPublicKeyHex: publicKeyHex,
            communityId,
          } as any, _keypair);
		  console.log('[Community] Request sent successfully');
        } catch {
			console.warn('[Community] Failed to send request:', err);
		}
        setTimeout(sendRequest, 2000);
      };

      sendRequest();
    });
  },

  // ── Invite link ────────────────────────────────────────────────────────────
  generateInvite: (communityId) => buildInviteLink(communityId),

  // ── Presence ───────────────────────────────────────────────────────────────
  subscribePresence: (communityId) => {
    const { node } = useNetworkStore.getState();
    if (!node) return () => {};

    const topic = communityPresenceTopic(communityId);
    const unsub = subscribe(node, topic, (message: MusterMessage, senderPublicKeyHex: string) => {
      console.log('[Community] Received request type:', message.type, 'for:', communityId);
	  if (message.type !== 'peer.announce') return;
      const entry: OnlineMember = {
        publicKeyHex: senderPublicKeyHex,
        username: (message as any).username ?? senderPublicKeyHex.slice(0, 10),
        lastSeen: Date.now(),
      };
      set((state) => {
        const current = state.onlineMembers[communityId] ?? [];
        const filtered = current.filter((m) => m.publicKeyHex !== senderPublicKeyHex);
        return { onlineMembers: { ...state.onlineMembers, [communityId]: [...filtered, entry] } };
      });
    });

    get().announcePresence(communityId);
    const interval = setInterval(() => get().announcePresence(communityId), 30_000);
    return () => { unsub(); clearInterval(interval); };
  },

  announcePresence: async (communityId) => {
    const { node }                             = useNetworkStore.getState();
    const { _keypair, publicKeyHex, username } = useAuthStore.getState();
    if (!node || !_keypair || !publicKeyHex || !username) return;
    try {
      await publish(node, communityPresenceTopic(communityId), {
        v: 1 as const, id: generateId(), ts: now(),
        type: 'peer.announce' as const,
        senderPublicKeyHex: publicKeyHex,
        communityId, username,
      } as any, _keypair);
    } catch {}
  },
}));
