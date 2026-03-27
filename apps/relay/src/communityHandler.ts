/**
 * Community Handler — processes community-related messages on the relay.
 *
 * Handles: CREATE_COMMUNITY, JOIN_COMMUNITY, LEAVE_COMMUNITY,
 *          LIST_COMMUNITIES, GET_COMMUNITY
 *
 * This module is imported by the main relay index.ts.
 */

import { randomBytes } from 'crypto';
import { CommunityDB } from './communityDatabase';
import type { RelayClient } from './types';

/** Generate a community ID. */
function generateId(): string {
  return [
    randomBytes(4).toString('hex'),
    randomBytes(2).toString('hex'),
    '4' + randomBytes(2).toString('hex').slice(1),
    randomBytes(2).toString('hex'),
    randomBytes(6).toString('hex'),
  ].join('-');
}

export function handleCommunityMessage(
  client: RelayClient,
  msg: any,
  communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): boolean {
  switch (msg.type) {
    case 'CREATE_COMMUNITY':
      handleCreate(client, msg, communityDB, sendToClient);
      return true;

    case 'JOIN_COMMUNITY':
      handleJoin(client, msg, communityDB, sendToClient);
      return true;

    case 'LEAVE_COMMUNITY':
      handleLeave(client, msg, communityDB, sendToClient);
      return true;

    case 'LIST_COMMUNITIES':
      handleList(client, communityDB, sendToClient);
      return true;

    case 'GET_COMMUNITY':
      handleGet(client, msg, communityDB, sendToClient);
      return true;

    default:
      return false; // not a community message
  }
}

// =================================================================
// Handlers
// =================================================================

function handleCreate(
  client: RelayClient,
  msg: any,
  communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): void {
  const { name, description } = msg.payload || {};

  if (!name || !name.trim()) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'INVALID_NAME', message: 'Community name is required' },
      timestamp: Date.now(),
    });
    return;
  }

  const communityId = generateId();
  const now = Date.now();

  const defaultChannels = [
    { id: generateId(), name: 'general', type: 'text', visibility: 'public', position: 0 },
    { id: generateId(), name: 'announcements', type: 'text', visibility: 'readonly', position: 1 },
  ];

  // Store community
  communityDB.createCommunity({
    id: communityId,
    name: name.trim(),
    description: (description || '').trim(),
    type: 'public',
    ownerPublicKey: client.publicKey,
    ownerUsername: client.username,
    channelsJson: JSON.stringify(defaultChannels),
    createdAt: now,
  });

  // Add creator as owner member
  communityDB.addMember({
    communityId,
    publicKey: client.publicKey,
    username: client.username,
    role: 'owner',
    joinedAt: now,
  });

  const community = {
    id: communityId,
    name: name.trim(),
    description: (description || '').trim(),
    type: 'public' as const,
    ownerPublicKey: client.publicKey,
    ownerUsername: client.username,
    channels: defaultChannels,
    createdAt: now,
    memberCount: 1,
  };

  console.log(`[relay] Community created: "${name}" by ${client.username} (${communityId.slice(0, 8)}...)`);

  sendToClient(client, {
    type: 'COMMUNITY_CREATED',
    payload: { community },
    timestamp: Date.now(),
  });
}

function handleJoin(
  client: RelayClient,
  msg: any,
  communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): void {
  const { communityId } = msg.payload || {};

  if (!communityId) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'INVALID_ID', message: 'Community ID is required' },
      timestamp: Date.now(),
    });
    return;
  }

  // Check community exists
  const dbCommunity = communityDB.getCommunity(communityId);
  if (!dbCommunity) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'NOT_FOUND', message: 'Community not found' },
      timestamp: Date.now(),
    });
    return;
  }

  // Check if already a member
  if (communityDB.isMember(communityId, client.publicKey)) {
    // Already a member — just return the community data
    const community = dbToStoredCommunity(dbCommunity, communityDB);
    sendToClient(client, {
      type: 'COMMUNITY_JOINED',
      payload: { community },
      timestamp: Date.now(),
    });
    return;
  }

  // Add as member
  communityDB.addMember({
    communityId,
    publicKey: client.publicKey,
    username: client.username,
    role: 'member',
    joinedAt: Date.now(),
  });

  const community = dbToStoredCommunity(dbCommunity, communityDB);

  console.log(`[relay] ${client.username} joined community "${dbCommunity.name}" (${communityId.slice(0, 8)}...)`);

  sendToClient(client, {
    type: 'COMMUNITY_JOINED',
    payload: { community },
    timestamp: Date.now(),
  });
}

function handleLeave(
  client: RelayClient,
  msg: any,
  communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): void {
  const { communityId } = msg.payload || {};

  if (!communityId) return;

  communityDB.removeMember(communityId, client.publicKey);

  console.log(`[relay] ${client.username} left community ${communityId.slice(0, 8)}...`);

  sendToClient(client, {
    type: 'COMMUNITY_LEFT',
    payload: { communityId },
    timestamp: Date.now(),
  });
}

function handleList(
  client: RelayClient,
  communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): void {
  const dbCommunities = communityDB.getCommunitiesForUser(client.publicKey);
  const communities = dbCommunities.map((c) => dbToStoredCommunity(c, communityDB));

  console.log(`[relay] ${client.username} listed ${communities.length} communities`);

  sendToClient(client, {
    type: 'COMMUNITIES_LIST',
    payload: { communities },
    timestamp: Date.now(),
  });
}

function handleGet(
  client: RelayClient,
  msg: any,
  communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): void {
  const { communityId } = msg.payload || {};

  if (!communityId) return;

  const dbCommunity = communityDB.getCommunity(communityId);
  if (!dbCommunity) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'NOT_FOUND', message: 'Community not found' },
      timestamp: Date.now(),
    });
    return;
  }

  const community = dbToStoredCommunity(dbCommunity, communityDB);
  const membersRaw = communityDB.getMembers(communityId);
  const members = membersRaw.map((m) => ({
    publicKey: m.publicKey,
    username: m.username,
    role: m.role as 'owner' | 'admin' | 'moderator' | 'member',
    joinedAt: m.joinedAt,
  }));

  sendToClient(client, {
    type: 'COMMUNITY_DATA',
    payload: { community, members },
    timestamp: Date.now(),
  });
}

// =================================================================
// Helpers
// =================================================================

function dbToStoredCommunity(db: any, communityDB: CommunityDB): any {
  let channels = [];
  try {
    channels = JSON.parse(db.channelsJson || '[]');
  } catch { channels = []; }

  return {
    id: db.id,
    name: db.name,
    description: db.description || '',
    type: db.type || 'public',
    ownerPublicKey: db.ownerPublicKey,
    ownerUsername: db.ownerUsername,
    channels,
    createdAt: db.createdAt,
    memberCount: communityDB.getMemberCount(db.id),
  };
}
