/**
 * resetUserStores — wipe all per-user client state on logout / account switch.
 *
 * The Zustand stores are module singletons that live for the whole app
 * session. Without an explicit reset, logging out and signing in as a
 * different account (in the same window) leaves the previous user's squads,
 * communities, DMs, etc. in memory — and their localStorage / IndexedDB
 * caches on disk. That let a brand-new account *see and type in* squads it was
 * never a member of (the relay rejects the writes, but the optimistic UI made
 * it look like they went through).
 *
 * This resets the in-memory data of every per-user store (preserving their
 * methods via a merge setState), drops the local mic/voice session, and clears
 * the per-user on-disk caches. Node-level / preference state (node discovery,
 * locale, read-receipt default) is intentionally left alone — those are not
 * tied to a single account.
 */

import { useSquadStore } from './squadStore';
import { useCommunityStore } from './communityStore';
import { useDMStore } from './dmStore';
import { useChatStore } from './chatStore';
import { useFriendStore } from './friendStore';
import { usePostStore } from './postStore';
import { useVoiceStore } from './voiceStore';
import { useGroupCryptoStore } from './groupCryptoStore';
import { useManifestStore } from './manifestStore';

/** Per-user localStorage caches to drop on account switch. */
const LS_USER_KEYS = [
  'muster-communities',
  'muster-community-order',
  'muster-squad-order',
];

export function resetUserStores(): void {
  // In-memory store data (keep methods — merge, don't replace).
  useSquadStore.setState({ squads: {}, members: {}, messages: {}, activeSquadId: null, lastMessage: '', loading: false, squadOrder: [] });
  useCommunityStore.setState({ communities: {}, onlineMembers: {}, members: {}, myRoles: {}, communityOrder: [] });
  useDMStore.setState({ messages: {}, conversations: [], activeConversation: null });
  useFriendStore.setState({ friends: [], incomingRequests: [], outgoingRequests: [], blockedUsers: [], lastMessage: '', loading: false });
  usePostStore.setState({ posts: {}, comments: {}, expandedPostId: null, lastMessage: '', loading: false });
  useManifestStore.setState({ byCommunity: {} });
  useGroupCryptoStore.setState({ channels: new Map() });

  // Drop the local voice session (mic + peer connections) and roster cache.
  try { useVoiceStore.getState().leave(); } catch { /* not in a call */ }
  useVoiceStore.setState({ currentChannel: null, participants: [], rosters: {}, muted: false, connecting: false, error: '' });

  // Cached messages in IndexedDB (community + DM) — chatStore.clear() wipes the
  // shared BrowserDB and its own in-memory message/presence maps.
  try { useChatStore.getState().clear(); } catch { /* ignore */ }

  // Per-user on-disk caches.
  for (const k of LS_USER_KEYS) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  }
}
