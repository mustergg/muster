/**
 * Community store — manages real communities.
 *
 * Communities are stored in localStorage for immediate availability,
 * and also written to OrbitDB when available for P2P sync.
 */

import { create } from 'zustand';
import { generateId, now } from '@muster/protocol';
import type { StoredCommunity, StoredCommunityMember, StoredChannel } from '@muster/db';
import { useDBStore } from './dbStore.js';
import { useAuthStore } from './authStore.js';
import { useNetworkStore } from './networkStore.js';
import { communityPresenceTopic, subscribe, publish } from '@muster/core';
import type { MusterMessage } from '@muster/protocol';

// ─── Local storage helpers ────────────────────────────────────────────────────

const LS_JOINED   = 'muster:joined-ids';
const LS_COMMUNITY = (id: string) => `muster:community:${id}`;

function lsGet<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') as T; }
  catch { return null; }
}
function lsSet(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function lsDel(key: string): void {
  try { localStorage.removeItem(key); } catch {}
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
    // Maybe it's just a bare community ID
    if (/^[a-f0-9-]{36}$/i.test(url.trim())) return url.trim();
    return null;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OnlineMember {
  publicKeyHex: string;
  username: string;
  lastSeen: number;
}

// ─── Store ────────────────────────────────────────────────────────────────────

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
}

export const useCommunityStore = create<CommunityState>()((set, get) => ({
  communities:   {},
  onlineMembers: {},
  loading:       false,
  error:         null,

  // ── Load from localStorage on startup ──────────────────────────────────────
  loadCommunities: () => {
    const ids = getJoinedIds();
    const communities: Record<string, StoredCommunity> = {};
    for (const id of ids) {
      const c = lsGet<StoredCommunity>(LS_COMMUNITY(id));
      if (c) communities[id] = c;
    }
    set({ communities });

    // Also try to sync from OrbitDB in background (non-blocking)
    const { db } = useDBStore.getState();
    if (!db) return;
    for (const id of ids) {
      db.openCommunity(id)
        .then((store) => store.getMeta())
        .then((meta) => {
          if (meta) {
            lsSet(LS_COMMUNITY(meta.id), meta);
            set((state) => ({ communities: { ...state.communities, [meta.id]: meta } }));
          }
        })
        .catch(() => { /* non-fatal */ });
    }
  },

  // ── Create a new community ─────────────────────────────────────────────────
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

    // Always save to localStorage first — instant, no dependencies
    lsSet(LS_COMMUNITY(communityId), community);
    addJoinedId(communityId);
    set((state) => ({ communities: { ...state.communities, [communityId]: community } }));

    // Try to also persist to OrbitDB (best-effort, non-blocking)
    const { db } = useDBStore.getState();
    if (db) {
      try {
        const store = await db.openCommunity(communityId);
        await store.setMeta(community);
        const member: StoredCommunityMember = {
          publicKeyHex,
          username,
          role: 'owner',
          customRoleIds: [],
          joinedAt: ts,
        };
        await store.setMember(member);
      } catch (err) {
        // Non-fatal — community is already saved to localStorage
        console.warn('[Community] OrbitDB persist failed (non-fatal):', err);
      }
    }

    return community;
  },

  // ── Join via invite link ───────────────────────────────────────────────────
  joinCommunity: async (communityId) => {
    const { publicKeyHex, username } = useAuthStore.getState();
    if (!publicKeyHex || !username) throw new Error('Not authenticated');

    if (get().communities[communityId]) return get().communities[communityId]!;

    // Wait for OrbitDB to be ready (up to 8 seconds)
    let resolvedDb = useDBStore.getState().db;
    if (!resolvedDb) {
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 500));
        resolvedDb = useDBStore.getState().db;
        if (resolvedDb) break;
      }
    }
    if (!resolvedDb) throw new Error('Database not ready — please wait a few seconds and try again');

    let meta: StoredCommunity | null = null;
    try {
      const store = await resolvedDb.openCommunity(communityId);
      for (let i = 0; i < 16; i++) {
        meta = await store.getMeta();
        if (meta) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      if (meta) {
        await store.setMember({ publicKeyHex, username, role: 'member', customRoleIds: [], joinedAt: now() });
      }
    } catch (err) {
      console.warn('[Community] OrbitDB join error:', err);
    }

    if (!meta) throw new Error('Community not found. Make sure the creator is online and both users are connected to the bootstrap node.');

    lsSet(LS_COMMUNITY(communityId), meta);
    addJoinedId(communityId);
    set((state) => ({ communities: { ...state.communities, [communityId]: meta! } }));
    return meta;
  },

  // ── Generate invite link ───────────────────────────────────────────────────
  generateInvite: (communityId) => buildInviteLink(communityId),

  // ── Presence ───────────────────────────────────────────────────────────────
  subscribePresence: (communityId) => {
    const { node } = useNetworkStore.getState();
    if (!node) return () => {};

    const topic = communityPresenceTopic(communityId);

    const unsub = subscribe(node, topic, (message: MusterMessage, senderPublicKeyHex: string) => {
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

    // Announce immediately + every 30s
    get().announcePresence(communityId);
    const interval = setInterval(() => get().announcePresence(communityId), 30_000);

    return () => { unsub(); clearInterval(interval); };
  },

  announcePresence: async (communityId) => {
    const { node }                           = useNetworkStore.getState();
    const { _keypair, publicKeyHex, username } = useAuthStore.getState();
    if (!node || !_keypair || !publicKeyHex || !username) return;
    try {
      await publish(node, communityPresenceTopic(communityId), {
        v: 1 as const,
        id: generateId(),
        ts: now(),
        type: 'peer.announce' as const,
        senderPublicKeyHex: publicKeyHex,
        communityId,
        username,
      } as any, _keypair);
    } catch { /* non-fatal */ }
  },
}));
