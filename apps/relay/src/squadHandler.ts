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

export function handleSquadMessage(
  client: RelayClient,
  msg: any,
  squadDB: SquadDB,
  userDB: UserDB,
  communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  switch (msg.type) {
    case 'CREATE_SQUAD':          handleCreate(client, msg, squadDB, communityDB, sendToClient, clients); break;
    case 'GET_SQUADS':            handleGetSquads(client, msg, squadDB, sendToClient); break;
    case 'INVITE_TO_SQUAD':       handleInvite(client, msg, squadDB, userDB, sendToClient, clients); break;
    case 'LEAVE_SQUAD':           handleLeave(client, msg, squadDB, sendToClient); break;
    case 'KICK_FROM_SQUAD':       handleKick(client, msg, squadDB, sendToClient, clients); break;
    case 'DELETE_SQUAD':          handleDelete(client, msg, squadDB, sendToClient); break;
    case 'GET_SQUAD_MEMBERS':     handleGetMembers(client, msg, squadDB, sendToClient); break;
    case 'SUBSCRIBE_SQUAD':       handleSubscribe(client, msg, squadDB); break;
    case 'SEND_SQUAD_MESSAGE':    handleSendMessage(client, msg, squadDB, sendToClient); break;
    case 'SQUAD_HISTORY_REQUEST': handleHistory(client, msg, squadDB, sendToClient); break;
  }
}

/** Clean up squad subscriptions when client disconnects. */
export function cleanupSquadSubscriptions(ws: WebSocket): void {
  for (const [squadId, subs] of squadChannels) {
    subs.delete(ws);
    if (subs.size === 0) squadChannels.delete(squadId);
  }
}

// =================================================================
// Handlers
// =================================================================

function handleCreate(
  client: RelayClient, msg: any, squadDB: SquadDB, communityDB: CommunityDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  const { communityId, name } = msg.payload || {};
  if (!communityId || !name?.trim()) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'CREATE_SQUAD', success: false, message: 'Squad name is required.' }, timestamp: Date.now() });
    return;
  }

  // Must be a member of the community
  const members = communityDB.getMembers(communityId);
  const isMember = members.some((m) => m.publicKey === client.publicKey);
  if (!isMember) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'CREATE_SQUAD', success: false, message: 'You must be a community member to create a squad.' }, timestamp: Date.now() });
    return;
  }

  if (name.trim().length > 50) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'CREATE_SQUAD', success: false, message: 'Squad name must be 50 characters or fewer.' }, timestamp: Date.now() });
    return;
  }

  const squad = squadDB.createSquad(communityId, name.trim(), client.publicKey, client.username);
  const payload = { ...squad, memberCount: 1 };

  sendToClient(client, { type: 'SQUAD_CREATED', payload, timestamp: Date.now() });
}

function handleGetSquads(
  client: RelayClient, msg: any, squadDB: SquadDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const { communityId } = msg.payload || {};
  if (!communityId) return;

  const squads = squadDB.getSquadsForCommunity(communityId);
  // Only return squads where user is a member
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

  if (!squadDB.isOwner(squadId, client.publicKey)) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'KICK_FROM_SQUAD', success: false, message: 'Only the squad owner can kick members.' }, timestamp: Date.now() });
    return;
  }

  if (publicKey === client.publicKey) {
    sendToClient(client, { type: 'SQUAD_RESULT', payload: { action: 'KICK_FROM_SQUAD', success: false, message: 'Cannot kick yourself.' }, timestamp: Date.now() });
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

function handleSubscribe(client: RelayClient, msg: any, squadDB: SquadDB): void {
  const { squadId } = msg.payload || {};
  if (!squadId) return;

  if (!squadDB.isMember(squadId, client.publicKey)) return;

  if (!squadChannels.has(squadId)) squadChannels.set(squadId, new Set());
  squadChannels.get(squadId)!.add(client.ws);
}

function handleSendMessage(
  client: RelayClient, msg: any, squadDB: SquadDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const { squadId, content, messageId } = msg.payload || {};
  if (!squadId || !content || !messageId) return;

  if (!squadDB.isMember(squadId, client.publicKey)) return;

  const timestamp = Date.now();
  squadDB.storeMessage({ messageId, squadId, content, senderPublicKey: client.publicKey, senderUsername: client.username, timestamp });

  const outgoing = {
    type: 'SQUAD_MESSAGE',
    payload: { squadId, messageId, content, senderPublicKey: client.publicKey, senderUsername: client.username, timestamp },
    timestamp,
  };

  // Broadcast to all subscribed (including sender for confirmation)
  broadcastToSquad(squadId, outgoing, client.ws);
}

function handleHistory(
  client: RelayClient, msg: any, squadDB: SquadDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const { squadId, since } = msg.payload || {};
  if (!squadId) return;

  if (!squadDB.isMember(squadId, client.publicKey)) return;

  const messages = squadDB.getMessagesSince(squadId, since || 0);
  sendToClient(client, {
    type: 'SQUAD_HISTORY_RESPONSE',
    payload: {
      squadId,
      messages: messages.map((m) => ({
        messageId: m.messageId, content: m.content,
        senderPublicKey: m.senderPublicKey, senderUsername: m.senderUsername,
        timestamp: m.timestamp,
      })),
    },
    timestamp: Date.now(),
  });
}
