/**
 * Squad Handler — R13
 *
 * Handles: CREATE_SQUAD, GET_SQUADS, INVITE_TO_SQUAD, LEAVE_SQUAD,
 *          KICK_FROM_SQUAD, DELETE_SQUAD, GET_SQUAD_MEMBERS,
 *          SUBSCRIBE_SQUAD, SEND_SQUAD_MESSAGE, SQUAD_HISTORY_REQUEST
 */

import { SquadDB } from './squadDB';
import { UserDB } from './userDB';
import { CommunityDB } from './communityDB';
import type { RelayClient } from './types';
import { WebSocket } from 'ws';

/** Map of squadId → subscribed WebSockets (for real-time messaging). */
const squadChannels = new Map<string, Set<WebSocket>>();

/** Last-seen SquadDB handle, so presence broadcasts (which don't take squadDB
 *  as a param) can check ghost membership. Set on every squad message. */
let lastSquadDB: SquadDB | null = null;

function findClientByKey(clients: Map<WebSocket, RelayClient>, publicKey: string): RelayClient | undefined {
  for (const c of clients.values()) {
    if (c.authenticated && c.publicKey === publicKey) return c;
  }
  return undefined;
}

function broadcastToSquad(squadId: string, msg: Record<string, unknown>, excludeWs?: WebSocket): void {
  const subs = squadChannels.get(squadId);
  if (!subs) return;
  const payload = JSON.stringify(msg);
  for (const ws of subs) {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

/** Forward an arbitrary message to a squad's subscribers (e.g. read receipts). */
export function forwardToSquad(squadId: string, msg: Record<string, unknown>, excludeWs?: WebSocket): void {
  broadcastToSquad(squadId, msg, excludeWs);
}

/** Broadcast the squad's online roster (subscribed members) to its
 *  subscribers. Invisible users are masked (reported as not online). Offline
 *  members are derived client-side from the full member list. */
export function broadcastSquadPresence(squadId: string, clients: Map<WebSocket, RelayClient>): void {
  const subs = squadChannels.get(squadId);
  if (!subs) return;
  const online: Array<{ publicKey: string; username: string; status: string; mood?: string }> = [];
  for (const ws of subs) {
    const c = clients.get(ws);
    if (!c?.authenticated) continue;
    const status = c.status || 'online';
    if (status === 'invisible') continue; // masked
    // Ghost (community-staff) members are hidden from presence — they show in
    // the member list with a badge but never as "online".
    if (lastSquadDB?.getMember(squadId, c.publicKey)?.ghost) continue;
    online.push({ publicKey: c.publicKey, username: c.username, status, mood: c.mood });
  }
  const payload = JSON.stringify({ type: 'SQUAD_PRESENCE', payload: { squadId, online }, timestamp: Date.now() });
  for (const ws of subs) { if (ws.readyState === WebSocket.OPEN) ws.send(payload); }
}

/** Re-broadcast presence for every squad a given connection belongs to
 *  (used when that user changes availability). */
export function broadcastSquadPresenceForWs(ws: WebSocket, clients: Map<WebSocket, RelayClient>): void {
  for (const [squadId, subs] of squadChannels) {
    if (subs.has(ws)) broadcastSquadPresence(squadId, clients);
  }
}

export function handleSquadMessage(
  client: RelayClient,
  msg: any,
  squadDB: SquadDB,
  userDB: UserDB,
  communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  lastSquadDB = squadDB;
  switch (msg.type) {
    case 'CREATE_SQUAD':          handleCreate(client, msg, squadDB, communityDB, userDB, sendToClient, clients); break;
    case 'GET_SQUADS':            handleGetSquads(client, msg, squadDB, communityDB, sendToClient); break;
    case 'GET_MY_SQUADS':         handleGetMySquads(client, squadDB, sendToClient); break;
    case 'INVITE_TO_SQUAD':       handleInvite(client, msg, squadDB, userDB, sendToClient, clients); break;
    case 'LEAVE_SQUAD':           handleLeave(client, msg, squadDB, sendToClient); break;
    case 'KICK_FROM_SQUAD':       handleKick(client, msg, squadDB, sendToClient, clients); break;
    case 'DELETE_SQUAD':          handleDelete(client, msg, squadDB, sendToClient); break;
    case 'DETACH_SQUAD':          handleDetach(client, msg, squadDB, communityDB, sendToClient); break;
    case 'GET_SQUAD_MEMBERS':     handleGetMembers(client, msg, squadDB, sendToClient); break;
    case 'SUBSCRIBE_SQUAD':       handleSubscribe(client, msg, squadDB, clients); break;
    case 'SEND_SQUAD_MESSAGE':    handleSendMessage(client, msg, squadDB, sendToClient); break;
    case 'DELETE_SQUAD_MESSAGE':  handleDeleteMessage(client, msg, squadDB, sendToClient); break;
    case 'SQUAD_HISTORY_REQUEST': handleHistory(client, msg, squadDB, sendToClient); break;
  }
}

/** Clean up squad subscriptions when client disconnects. */
export function cleanupSquadSubscriptions(ws: WebSocket, clients?: Map<WebSocket, RelayClient>): void {
  for (const [squadId, subs] of squadChannels) {
    if (!subs.delete(ws)) continue;
    if (subs.size === 0) squadChannels.delete(squadId);
    else if (clients) broadcastSquadPresence(squadId, clients);
  }
}

// =================================================================
// Handlers
// =================================================================

function handleCreate(
  client: RelayClient, msg: any, squadDB: SquadDB, communityDB: CommunityDB,
  userDB: UserDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  const { communityId, name } = msg.payload || {};
  if (!communityId || !name?.trim()) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'CREATE_SQUAD', success: false, message: 'Squad name is required.' }, timestamp: Date.now() });
    return;
  }

  // Verified-only: basic accounts cannot create squads.
  if (!userDB.isVerified(client.publicKey)) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'CREATE_SQUAD', success: false, message: 'Verify your email to create squads.' }, timestamp: Date.now() });
    return;
  }

  // Personal squads (friends groups not tied to a community) use the
  // sentinel id `personal:<ownerPubkey>`. They skip the community-membership
  // check, but the caller may only create within their own personal space.
  const isPersonal = typeof communityId === 'string' && communityId.startsWith('personal:');
  if (isPersonal) {
    if (communityId !== `personal:${client.publicKey}`) {
      sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'CREATE_SQUAD', success: false, message: 'Invalid personal squad space.' }, timestamp: Date.now() });
      return;
    }
  } else {
    // Community squads can only be created by community staff (moderator+).
    const role = communityDB.getMemberRole(communityId, client.publicKey);
    const isStaff = role === 'owner' || role === 'admin' || role === 'moderator';
    if (!isStaff) {
      sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'CREATE_SQUAD', success: false, message: 'Only community moderators and above can create squads in this community.' }, timestamp: Date.now() });
      return;
    }
  }

  if (name.trim().length > 50) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'CREATE_SQUAD', success: false, message: 'Squad name must be 50 characters or fewer.' }, timestamp: Date.now() });
    return;
  }

  const squad = squadDB.createSquad(communityId, name.trim(), client.publicKey, client.username);

  // Community staff (mods/admins/owner) become ghost members so they can
  // moderate + hold the group key. Skipped for personal squads.
  if (!isPersonal) {
    addCommunityStaffAsGhosts(squad.id, communityId, squadDB, communityDB, client.publicKey);
  }

  const payload = { ...squad, memberCount: squadDB.getMemberCount(squad.id) };
  sendToClient(client, { type: 'SQUAD_CREATED', payload, timestamp: Date.now() });
}

/** Add a community's staff (owner/admin/moderator) as ghost members of a squad
 *  and announce each newly-added ghost so the squad owner can hand them the
 *  group key. `excludeKey` skips the squad owner (already a real member). */
function addCommunityStaffAsGhosts(
  squadId: string, communityId: string, squadDB: SquadDB, communityDB: CommunityDB, excludeKey: string,
): void {
  const staff = communityDB.getMembers(communityId)
    .filter((m) => (m.role === 'owner' || m.role === 'admin' || m.role === 'moderator') && m.publicKey !== excludeKey)
    .map((m) => ({ publicKey: m.publicKey, username: m.username, role: m.role }));
  const added = squadDB.ensureGhostStaff(squadId, staff);
  for (const g of added) {
    broadcastToSquad(squadId, { type: 'SQUAD_MEMBER_JOINED', payload: { squadId, member: { publicKey: g.publicKey, username: g.username, role: g.role, ghost: 1, joinedAt: g.joinedAt } }, timestamp: Date.now() });
  }
}

/** Return every squad the requester is a member of (any community + personal),
 *  grouped into one SQUAD_LIST per community so the client store keys them
 *  correctly. Works for squad-only users who aren't community members. */
function handleGetMySquads(
  client: RelayClient, squadDB: SquadDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const squads = squadDB.getAllUserSquads(client.publicKey);
  const byCommunity: Record<string, any[]> = {};
  for (const s of squads) {
    if (!byCommunity[s.communityId]) byCommunity[s.communityId] = [];
    byCommunity[s.communityId]!.push(s);
  }
  for (const communityId of Object.keys(byCommunity)) {
    sendToClient(client, { type: 'SQUAD_LIST', payload: { communityId, squads: byCommunity[communityId] }, timestamp: Date.now() });
  }
}

function handleGetSquads(
  client: RelayClient, msg: any, squadDB: SquadDB, communityDB: CommunityDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const { communityId } = msg.payload || {};
  if (!communityId) return;

  const squads = squadDB.getSquadsForCommunity(communityId);

  // Backfill: if the requester is community staff, ensure they're a ghost
  // member of every squad here (covers squads created before they were staff,
  // or before this feature). This is what gives staff moderation access.
  const role = communityDB.getMemberRole(communityId, client.publicKey);
  if (role === 'owner' || role === 'admin' || role === 'moderator') {
    for (const s of squads) {
      const added = squadDB.ensureGhostStaff(s.id, [{ publicKey: client.publicKey, username: client.username, role }]);
      for (const g of added) {
        broadcastToSquad(s.id, { type: 'SQUAD_MEMBER_JOINED', payload: { squadId: s.id, member: { publicKey: g.publicKey, username: g.username, role: g.role, ghost: 1, joinedAt: g.joinedAt } }, timestamp: Date.now() });
      }
    }
  }

  // Only return squads where user is a member (now includes ghost staff).
  const mySquads = squads.filter((s) => squadDB.isMember(s.id, client.publicKey));
  sendToClient(client, { type: 'SQUAD_LIST', payload: { communityId, squads: mySquads }, timestamp: Date.now() });
}

function handleInvite(
  client: RelayClient, msg: any, squadDB: SquadDB, userDB: UserDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  const { squadId, targetUsername } = msg.payload || {};
  if (!squadId || !targetUsername) return;

  // Verified-only: basic accounts cannot invite to squads.
  if (!userDB.isVerified(client.publicKey)) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'INVITE_TO_SQUAD', success: false, message: 'Verify your email to invite members.' }, timestamp: Date.now() });
    return;
  }

  // Must be squad owner to invite
  if (!squadDB.isOwner(squadId, client.publicKey)) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'INVITE_TO_SQUAD', success: false, message: 'Only the squad owner can invite members.' }, timestamp: Date.now() });
    return;
  }

  const squad = squadDB.getSquad(squadId);
  if (!squad) return;

  // Check member limit
  if (squadDB.getMemberCount(squadId) >= 50) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'INVITE_TO_SQUAD', success: false, message: 'Squad is full (50 members max).' }, timestamp: Date.now() });
    return;
  }

  // Find target user
  const target = userDB.getUserByUsername(targetUsername);
  if (!target) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'INVITE_TO_SQUAD', success: false, message: `User "${targetUsername}" not found.` }, timestamp: Date.now() });
    return;
  }

  if (squadDB.isMember(squadId, target.publicKey)) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'INVITE_TO_SQUAD', success: false, message: `${targetUsername} is already in this squad.` }, timestamp: Date.now() });
    return;
  }

  // Add member directly (invite-only = owner adds them)
  squadDB.addMember(squadId, target.publicKey, target.username);
  const member = { publicKey: target.publicKey, username: target.username, role: 'member', joinedAt: Date.now() };

  sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'INVITE_TO_SQUAD', success: true, message: `${targetUsername} added to squad.` }, timestamp: Date.now() });

  // Notify all squad subscribers
  broadcastToSquad(squadId, { type: 'SQUAD_MEMBER_JOINED', payload: { squadId, member }, timestamp: Date.now() });

  // Notify the invited user if online
  const targetClient = findClientByKey(clients, target.publicKey);
  if (targetClient) {
    sendToClient(targetClient, { type: 'SQUAD_CREATED', payload: { ...squad, memberCount: squadDB.getMemberCount(squadId) }, timestamp: Date.now() });
  }
}

function handleLeave(
  client: RelayClient, msg: any, squadDB: SquadDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const { squadId } = msg.payload || {};
  if (!squadId) return;

  if (squadDB.isOwner(squadId, client.publicKey)) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'LEAVE_SQUAD', success: false, message: 'Squad owner cannot leave. Delete the squad instead.' }, timestamp: Date.now() });
    return;
  }

  const removed = squadDB.removeMember(squadId, client.publicKey);
  if (!removed) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'LEAVE_SQUAD', success: false, message: 'You are not in this squad.' }, timestamp: Date.now() });
    return;
  }

  // Unsubscribe from squad channel
  squadChannels.get(squadId)?.delete(client.ws);

  sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'LEAVE_SQUAD', success: true, message: 'Left the squad.' }, timestamp: Date.now() });
  broadcastToSquad(squadId, { type: 'SQUAD_MEMBER_LEFT', payload: { squadId, publicKey: client.publicKey }, timestamp: Date.now() });
}

function handleKick(
  client: RelayClient, msg: any, squadDB: SquadDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  const { squadId, publicKey } = msg.payload || {};
  if (!squadId || !publicKey) return;

  // Allowed: squad owner, or community staff (ghost admin/moderator).
  const me = squadDB.getMember(squadId, client.publicKey);
  const canModerate = squadDB.isOwner(squadId, client.publicKey) || me?.role === 'admin' || me?.role === 'moderator';
  if (!canModerate) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'KICK_FROM_SQUAD', success: false, message: 'Only the squad owner or community staff can kick members.' }, timestamp: Date.now() });
    return;
  }

  if (publicKey === client.publicKey) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'KICK_FROM_SQUAD', success: false, message: 'Cannot kick yourself.' }, timestamp: Date.now() });
    return;
  }

  // Can't kick the squad owner or other community staff (ghosts).
  const target = squadDB.getMember(squadId, publicKey);
  if (!target) return;
  if (squadDB.isOwner(squadId, publicKey)) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'KICK_FROM_SQUAD', success: false, message: 'Cannot kick the squad owner.' }, timestamp: Date.now() });
    return;
  }
  if (target.ghost) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'KICK_FROM_SQUAD', success: false, message: 'Cannot kick community staff.' }, timestamp: Date.now() });
    return;
  }

  const removed = squadDB.removeMember(squadId, publicKey);
  if (!removed) return;

  sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'KICK_FROM_SQUAD', success: true, message: 'Member removed from squad.' }, timestamp: Date.now() });
  broadcastToSquad(squadId, { type: 'SQUAD_MEMBER_LEFT', payload: { squadId, publicKey }, timestamp: Date.now() });

  // Notify kicked user
  const kickedClient = findClientByKey(clients, publicKey);
  if (kickedClient) {
    sendToClient(kickedClient, { type: 'SQUAD_DELETED', payload: { squadId, communityId: '' }, timestamp: Date.now() });
    squadChannels.get(squadId)?.delete(kickedClient.ws);
  }
  broadcastSquadPresence(squadId, clients);
}

function handleDelete(
  client: RelayClient, msg: any, squadDB: SquadDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const { squadId } = msg.payload || {};
  if (!squadId) return;

  const squad = squadDB.getSquad(squadId);
  if (!squad) return;

  if (!squadDB.isOwner(squadId, client.publicKey)) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'DELETE_SQUAD', success: false, message: 'Only the squad owner can delete it.' }, timestamp: Date.now() });
    return;
  }

  // Broadcast deletion before deleting data
  broadcastToSquad(squadId, { type: 'SQUAD_DELETED', payload: { squadId, communityId: squad.communityId }, timestamp: Date.now() });
  sendToClient(client, { type: 'SQUAD_DELETED', payload: { squadId, communityId: squad.communityId }, timestamp: Date.now() });

  squadDB.deleteSquad(squadId);
  squadChannels.delete(squadId);
}

function handleDetach(
  client: RelayClient, msg: any, squadDB: SquadDB, communityDB: CommunityDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const { squadId } = msg.payload || {};
  if (!squadId) return;
  const squad = squadDB.getSquad(squadId);
  if (!squad) return;

  if (squad.communityId.startsWith('personal:')) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'DETACH_SQUAD', success: false, message: 'Squad is already personal.' }, timestamp: Date.now() });
    return;
  }

  // Allowed: the squad owner, or the community owner/admins.
  const isSquadOwner = squad.ownerPublicKey === client.publicKey;
  const role = communityDB.getMemberRole(squad.communityId, client.publicKey);
  const isCommunityStaff = role === 'owner' || role === 'admin';
  if (!isSquadOwner && !isCommunityStaff) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'DETACH_SQUAD', success: false, message: 'Only the squad owner or the community owner/admins can detach this squad.' }, timestamp: Date.now() });
    return;
  }

  const oldCommunityId = squad.communityId;
  const personalId = `personal:${squad.ownerPublicKey}`;
  squadDB.setCommunityId(squadId, personalId);
  // Community staff lose access — drop their ghost memberships. (The squad
  // owner should rotate the group key after detach to fully revoke.)
  squadDB.removeGhosts(squadId);

  const updated = { ...squad, communityId: personalId, memberCount: squadDB.getMemberCount(squadId) };
  const payload = { type: 'SQUAD_DETACHED', payload: { squadId, oldCommunityId, squad: updated }, timestamp: Date.now() };
  broadcastToSquad(squadId, payload);
  // Ensure the actor receives it even if not currently subscribed to the squad.
  sendToClient(client, payload);
  console.log(`[squad] ${client.username} detached squad ${squadId.slice(0, 12)} from community ${oldCommunityId.slice(0, 8)} → personal`);
}

function handleGetMembers(
  client: RelayClient, msg: any, squadDB: SquadDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const { squadId } = msg.payload || {};
  if (!squadId) return;

  if (!squadDB.isMember(squadId, client.publicKey)) return;

  const members = squadDB.getMembers(squadId);
  sendToClient(client, { type: 'SQUAD_MEMBER_LIST', payload: { squadId, members }, timestamp: Date.now() });
}

function handleSubscribe(client: RelayClient, msg: any, squadDB: SquadDB, clients: Map<WebSocket, RelayClient>): void {
  const { squadId } = msg.payload || {};
  if (!squadId) return;

  if (!squadDB.isMember(squadId, client.publicKey)) return;

  if (!squadChannels.has(squadId)) squadChannels.set(squadId, new Set());
  squadChannels.get(squadId)!.add(client.ws);

  // Tell the squad (and the joiner) the updated online roster.
  broadcastSquadPresence(squadId, clients);
}

function handleSendMessage(
  client: RelayClient, msg: any, squadDB: SquadDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const { squadId, content, messageId } = msg.payload || {};
  if (!squadId || !content || !messageId) return;
  const room = msg.payload?.room === 'voice' ? 'voice' : 'text';

  if (!squadDB.isMember(squadId, client.publicKey)) return;

  const timestamp = Date.now();
  squadDB.storeMessage({ messageId, squadId, content, senderPublicKey: client.publicKey, senderUsername: client.username, timestamp, room });

  const outgoing = {
    type: 'SQUAD_MESSAGE',
    payload: { squadId, messageId, content, senderPublicKey: client.publicKey, senderUsername: client.username, timestamp, room },
    timestamp,
  };

  // Broadcast to all subscribed (including sender for confirmation)
  broadcastToSquad(squadId, outgoing, client.ws);
}

const SQUAD_EDIT_WINDOW_MS = 15 * 60 * 1000;

function handleDeleteMessage(
  client: RelayClient, msg: any, squadDB: SquadDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const { squadId, messageId } = msg.payload || {};
  if (!squadId || !messageId) return;
  if (!squadDB.isMember(squadId, client.publicKey)) return;

  const message = squadDB.getMessage(messageId);
  if (!message || message.squadId !== squadId) return;

  const me = squadDB.getMember(squadId, client.publicKey);
  const isStaff = squadDB.isOwner(squadId, client.publicKey) || me?.role === 'admin' || me?.role === 'moderator';
  const isAuthorInWindow = message.senderPublicKey === client.publicKey && (Date.now() - message.timestamp) <= SQUAD_EDIT_WINDOW_MS;
  if (!isStaff && !isAuthorInWindow) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'DELETE_SQUAD_MESSAGE', success: false, message: 'You can only delete your own recent messages (or moderate as staff).' }, timestamp: Date.now() });
    return;
  }

  squadDB.deleteMessage(messageId);
  broadcastToSquad(squadId, { type: 'SQUAD_MESSAGE_DELETED', payload: { squadId, messageId, room: message.room || 'text' }, timestamp: Date.now() });
}

function handleHistory(
  client: RelayClient, msg: any, squadDB: SquadDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const { squadId, since } = msg.payload || {};
  if (!squadId) return;
  const room = msg.payload?.room === 'voice' ? 'voice' : 'text';

  if (!squadDB.isMember(squadId, client.publicKey)) return;

  const messages = squadDB.getMessagesSince(squadId, since || 0, room);
  sendToClient(client, {
    type: 'SQUAD_HISTORY_RESPONSE',
    payload: {
      squadId,
      room,
      messages: messages.map((m) => ({
        messageId: m.messageId, content: m.content,
        senderPublicKey: m.senderPublicKey, senderUsername: m.senderUsername,
        timestamp: m.timestamp,
      })),
    },
    timestamp: Date.now(),
  });
}
