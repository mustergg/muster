/**
 * Community handler — R8 update
 *
 * Changes from R7:
 * - LEAVE_COMMUNITY now blocks the owner from leaving
 *   (must transfer ownership first or delete the community)
 */

import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { CommunityDB } from './communityDB';
import { UserDB } from './userDB';
import type { RelayClient } from './types';

function generateId(): string {
  return randomUUID();
}

export function handleCommunityMessage(
  client: RelayClient,
  msg: any,
  communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
  channels: Map<string, Set<WebSocket>>,
  broadcastPresence: (channelId: string) => void,
  userDB?: UserDB,
): void {
  switch (msg.type) {
    case 'CREATE_COMMUNITY':
      handleCreate(client, msg, communityDB, sendToClient, channels, broadcastPresence);
      break;
    case 'JOIN_COMMUNITY':
      handleJoin(client, msg, communityDB, sendToClient, clients, channels, broadcastPresence);
      break;
    case 'LEAVE_COMMUNITY':
      handleLeave(client, msg, communityDB, sendToClient, clients, userDB);
      break;
    case 'LIST_COMMUNITIES':
      handleList(client, communityDB, sendToClient);
      break;
    case 'GET_COMMUNITY':
      handleGet(client, msg, communityDB, sendToClient);
      break;
  }
}

function handleCreate(
  client: RelayClient, msg: any, communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  channels: Map<string, Set<WebSocket>>,
  broadcastPresence: (channelId: string) => void,
): void {
  const { name, description } = msg.payload || {};
  if (!name || !name.trim()) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'INVALID_NAME', message: 'Community name is required' }, timestamp: Date.now() });
    return;
  }
  const communityId = generateId();
  const now = Date.now();
  const defaultChannels = [
    { id: generateId(), communityId, name: 'general', type: 'text', visibility: 'public', position: 0 },
    { id: generateId(), communityId, name: 'announcements', type: 'text', visibility: 'readonly', position: 1 },
  ];
  const owner = { communityId, publicKey: client.publicKey, username: client.username, role: 'owner', joinedAt: now };
  communityDB.createCommunity(
    { id: communityId, name: name.trim(), description: (description || '').trim(), type: 'public', ownerPublicKey: client.publicKey, createdAt: now },
    defaultChannels, owner,
  );
  console.log(`[relay] Community created: "${name}" (${communityId.slice(0, 8)}...) by ${client.username}`);
  for (const ch of defaultChannels) {
    client.channels.add(ch.id);
    if (!channels.has(ch.id)) channels.set(ch.id, new Set());
    channels.get(ch.id)!.add(client.ws);
    broadcastPresence(ch.id);
  }
  sendToClient(client, {
    type: 'COMMUNITY_DATA',
    payload: {
      community: { id: communityId, name: name.trim(), description: (description || '').trim(), type: 'public', ownerPublicKey: client.publicKey, channels: defaultChannels.map((ch) => ({ id: ch.id, name: ch.name, type: ch.type, visibility: ch.visibility, position: ch.position })), createdAt: now, memberCount: 1 },
      members: [{ publicKey: client.publicKey, username: client.username, role: 'owner', joinedAt: now }],
    },
    timestamp: Date.now(),
  });
}

function handleJoin(
  client: RelayClient, msg: any, communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
  channels: Map<string, Set<WebSocket>>,
  broadcastPresence: (channelId: string) => void,
): void {
  const { communityId } = msg.payload || {};
  if (!communityId) { sendToClient(client, { type: 'ERROR', payload: { code: 'INVALID_ID', message: 'Community ID is required' }, timestamp: Date.now() }); return; }
  const community = communityDB.getCommunity(communityId);
  if (!community) { sendToClient(client, { type: 'ERROR', payload: { code: 'NOT_FOUND', message: 'Community not found' }, timestamp: Date.now() }); return; }
  if (communityDB.isMember(communityId, client.publicKey)) {
    const dbChannels = communityDB.getChannels(communityId);
    const members = communityDB.getMembers(communityId);
    for (const ch of dbChannels) {
      client.channels.add(ch.id);
      if (!channels.has(ch.id)) channels.set(ch.id, new Set());
      channels.get(ch.id)!.add(client.ws);
      broadcastPresence(ch.id);
    }
    sendToClient(client, { type: 'COMMUNITY_DATA', payload: { community: { ...community, channels: dbChannels, memberCount: members.length }, members }, timestamp: Date.now() });
    return;
  }
  const now = Date.now();
  const newMember = { communityId, publicKey: client.publicKey, username: client.username, role: 'member' as const, joinedAt: now };
  communityDB.addMember(newMember);
  const dbChannels = communityDB.getChannels(communityId);
  const members = communityDB.getMembers(communityId);
  console.log(`[relay] ${client.username} joined community "${community.name}" (${members.length} members)`);
  for (const ch of dbChannels) {
    client.channels.add(ch.id);
    if (!channels.has(ch.id)) channels.set(ch.id, new Set());
    channels.get(ch.id)!.add(client.ws);
    broadcastPresence(ch.id);
  }
  sendToClient(client, { type: 'COMMUNITY_DATA', payload: { community: { ...community, channels: dbChannels, memberCount: members.length }, members }, timestamp: Date.now() });
  const memberUpdate = JSON.stringify({ type: 'COMMUNITY_MEMBER_UPDATE', payload: { communityId, members, action: 'joined', member: newMember }, timestamp: Date.now() });
  for (const [ws, c] of clients) {
    if (c.authenticated && c.publicKey !== client.publicKey && communityDB.isMember(communityId, c.publicKey) && ws.readyState === WebSocket.OPEN) {
      ws.send(memberUpdate);
    }
  }
}

function handleLeave(
  client: RelayClient, msg: any, communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
  userDB?: UserDB,
): void {
  const { communityId } = msg.payload || {};
  if (!communityId) return;

  // R8: Block owner from leaving — must transfer ownership or delete
  const community = communityDB.getCommunity(communityId);
  if (community && community.ownerPublicKey === client.publicKey) {
    const members = communityDB.getMembers(communityId);
    const isOnlyMember = members.length <= 1;

    if (isOnlyMember) {
      // Only member — can only delete
      sendToClient(client, {
        type: 'OWNER_CANNOT_LEAVE',
        payload: {
          communityId,
          reason: 'You are the only member. You can delete the community.',
          action: 'delete_only',
        },
        timestamp: Date.now(),
      });
    } else {
      // Has other members — must transfer first
      sendToClient(client, {
        type: 'OWNER_CANNOT_LEAVE',
        payload: {
          communityId,
          reason: 'Transfer ownership to another verified member before leaving, or delete the community.',
          action: 'transfer',
        },
        timestamp: Date.now(),
      });
    }
    return;
  }

  communityDB.removeMember(communityId, client.publicKey);
  const members = communityDB.getMembers(communityId);
  console.log(`[relay] ${client.username} left community ${communityId.slice(0, 8)}...`);
  const memberUpdate = JSON.stringify({ type: 'COMMUNITY_MEMBER_UPDATE', payload: { communityId, members, action: 'left', member: { publicKey: client.publicKey, username: client.username, role: 'member', joinedAt: 0 } }, timestamp: Date.now() });
  for (const [ws, c] of clients) {
    if (c.authenticated && communityDB.isMember(communityId, c.publicKey) && ws.readyState === WebSocket.OPEN) {
      ws.send(memberUpdate);
    }
  }

  // Confirm to the leaving user
  sendToClient(client, {
    type: 'COMMUNITY_LEFT',
    payload: { communityId },
    timestamp: Date.now(),
  });
}

function handleList(
  client: RelayClient, communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): void {
  const userCommunities = communityDB.getCommunitiesForUser(client.publicKey);
  const enriched = userCommunities.map((c) => ({ ...c, channels: communityDB.getChannels(c.id) }));
  sendToClient(client, { type: 'COMMUNITY_LIST', payload: { communities: enriched }, timestamp: Date.now() });
  console.log(`[relay] ${client.username} loaded ${enriched.length} communities`);
}

function handleGet(
  client: RelayClient, msg: any, communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): void {
  const { communityId } = msg.payload || {};
  if (!communityId) return;
  const community = communityDB.getCommunity(communityId);
  if (!community) { sendToClient(client, { type: 'ERROR', payload: { code: 'NOT_FOUND', message: 'Community not found' }, timestamp: Date.now() }); return; }
  const dbChannels = communityDB.getChannels(communityId);
  const members = communityDB.getMembers(communityId);
  sendToClient(client, { type: 'COMMUNITY_DATA', payload: { community: { ...community, channels: dbChannels, memberCount: members.length }, members }, timestamp: Date.now() });
}
