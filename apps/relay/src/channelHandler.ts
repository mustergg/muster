/**
 * Channel handler — manages channel CRUD within communities.
 *
 * Handles: CREATE_CHANNEL, EDIT_CHANNEL, DELETE_CHANNEL_CMD, REORDER_CHANNELS
 *
 * Permission: admin+ (owner or admin) for all operations.
 */

import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { CommunityDB } from './communityDB';
import type { RelayClient } from './types';

const ROLE_LEVEL: Record<string, number> = {
  owner: 4,
  admin: 3,
  moderator: 2,
  member: 1,
};

function isAdmin(role: string): boolean {
  return (ROLE_LEVEL[role] ?? 0) >= ROLE_LEVEL['admin']!;
}

export function handleChannelMessage(
  client: RelayClient,
  msg: any,
  communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
  channels: Map<string, Set<WebSocket>>,
  broadcastPresence: (channelId: string) => void,
): void {
  switch (msg.type) {
    case 'CREATE_CHANNEL':
      handleCreateChannel(client, msg, communityDB, sendToClient, clients, channels, broadcastPresence);
      break;
    case 'EDIT_CHANNEL':
      handleEditChannel(client, msg, communityDB, sendToClient, clients);
      break;
    case 'DELETE_CHANNEL_CMD':
      handleDeleteChannel(client, msg, communityDB, sendToClient, clients, channels);
      break;
    case 'REORDER_CHANNELS':
      handleReorderChannels(client, msg, communityDB, sendToClient, clients);
      break;
  }
}

// =================================================================
// CREATE_CHANNEL
// =================================================================

function handleCreateChannel(
  client: RelayClient,
  msg: any,
  communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
  channels: Map<string, Set<WebSocket>>,
  broadcastPresence: (channelId: string) => void,
): void {
  const { communityId, name, type, visibility } = msg.payload || {};

  if (!communityId || !name || !name.trim()) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'INVALID', message: 'Community ID and channel name are required' },
      timestamp: Date.now(),
    });
    return;
  }

  // Check permission
  const role = communityDB.getMemberRole(communityId, client.publicKey);
  if (!role || !isAdmin(role)) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'FORBIDDEN', message: 'Only admins and owners can create channels' },
      timestamp: Date.now(),
    });
    return;
  }

  // Validate channel name (lowercase, no spaces, 1-32 chars)
  const cleanName = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
  if (!cleanName || cleanName.length > 32) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'INVALID_NAME', message: 'Channel name must be 1-32 characters (letters, numbers, hyphens, underscores)' },
      timestamp: Date.now(),
    });
    return;
  }

  // Check for duplicate name in this community
  const existingChannels = communityDB.getChannels(communityId);
  if (existingChannels.some((ch) => ch.name === cleanName)) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'DUPLICATE_NAME', message: `A channel named "${cleanName}" already exists in this community` },
      timestamp: Date.now(),
    });
    return;
  }

  const channelType = type || 'text';
  const channelVisibility = visibility || 'public';
  const position = existingChannels.length;

  const channel = {
    id: randomUUID(),
    communityId,
    name: cleanName,
    type: channelType,
    visibility: channelVisibility,
    position,
  };

  communityDB.addChannel(channel);

  console.log(
    `[relay] Channel created: #${cleanName} in ${communityId.slice(0, 8)}... by ${client.username}`
  );

  // Auto-subscribe the creator
  client.channels.add(channel.id);
  if (!channels.has(channel.id)) channels.set(channel.id, new Set());
  channels.get(channel.id)!.add(client.ws);
  broadcastPresence(channel.id);

  // Notify all online community members
  const notification = JSON.stringify({
    type: 'CHANNEL_CREATED',
    payload: {
      communityId,
      channel: {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        visibility: channel.visibility,
        position: channel.position,
      },
      createdBy: client.username,
    },
    timestamp: Date.now(),
  });

  for (const [ws, c] of clients) {
    if (c.authenticated && communityDB.isMember(communityId, c.publicKey) && ws.readyState === WebSocket.OPEN) {
      ws.send(notification);
    }
  }
}

// =================================================================
// EDIT_CHANNEL
// =================================================================

function handleEditChannel(
  client: RelayClient,
  msg: any,
  communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  const { communityId, channelId, name, visibility } = msg.payload || {};

  if (!communityId || !channelId) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'INVALID', message: 'Community ID and channel ID are required' },
      timestamp: Date.now(),
    });
    return;
  }

  // Check permission
  const role = communityDB.getMemberRole(communityId, client.publicKey);
  if (!role || !isAdmin(role)) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'FORBIDDEN', message: 'Only admins and owners can edit channels' },
      timestamp: Date.now(),
    });
    return;
  }

  // Verify channel exists
  const existingChannels = communityDB.getChannels(communityId);
  const target = existingChannels.find((ch) => ch.id === channelId);
  if (!target) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'NOT_FOUND', message: 'Channel not found' },
      timestamp: Date.now(),
    });
    return;
  }

  // Validate new name if provided
  let newName = target.name;
  if (name !== undefined && name !== null) {
    newName = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
    if (!newName || newName.length > 32) {
      sendToClient(client, {
        type: 'ERROR',
        payload: { code: 'INVALID_NAME', message: 'Channel name must be 1-32 characters' },
        timestamp: Date.now(),
      });
      return;
    }
    // Check duplicate
    if (existingChannels.some((ch) => ch.id !== channelId && ch.name === newName)) {
      sendToClient(client, {
        type: 'ERROR',
        payload: { code: 'DUPLICATE_NAME', message: `A channel named "${newName}" already exists` },
        timestamp: Date.now(),
      });
      return;
    }
  }

  const newVisibility = visibility || target.visibility;

  communityDB.updateChannel(channelId, newName, newVisibility);

  console.log(
    `[relay] Channel edited: #${newName} (${channelId.slice(0, 8)}...) by ${client.username}`
  );

  // Notify all online community members
  const notification = JSON.stringify({
    type: 'CHANNEL_UPDATED',
    payload: {
      communityId,
      channel: {
        id: channelId,
        name: newName,
        type: target.type,
        visibility: newVisibility,
        position: target.position,
      },
      updatedBy: client.username,
    },
    timestamp: Date.now(),
  });

  for (const [ws, c] of clients) {
    if (c.authenticated && communityDB.isMember(communityId, c.publicKey) && ws.readyState === WebSocket.OPEN) {
      ws.send(notification);
    }
  }
}

// =================================================================
// DELETE_CHANNEL_CMD
// =================================================================

function handleDeleteChannel(
  client: RelayClient,
  msg: any,
  communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
  channels: Map<string, Set<WebSocket>>,
): void {
  const { communityId, channelId } = msg.payload || {};

  if (!communityId || !channelId) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'INVALID', message: 'Community ID and channel ID are required' },
      timestamp: Date.now(),
    });
    return;
  }

  // Check permission
  const role = communityDB.getMemberRole(communityId, client.publicKey);
  if (!role || !isAdmin(role)) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'FORBIDDEN', message: 'Only admins and owners can delete channels' },
      timestamp: Date.now(),
    });
    return;
  }

  // Verify channel exists
  const existingChannels = communityDB.getChannels(communityId);
  const target = existingChannels.find((ch) => ch.id === channelId);
  if (!target) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'NOT_FOUND', message: 'Channel not found' },
      timestamp: Date.now(),
    });
    return;
  }

  // Cannot delete the last channel
  if (existingChannels.length <= 1) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'LAST_CHANNEL', message: 'Cannot delete the last channel in a community' },
      timestamp: Date.now(),
    });
    return;
  }

  communityDB.deleteChannel(channelId);

  // Clean up subscriptions for this channel
  const subs = channels.get(channelId);
  if (subs) {
    for (const ws of subs) {
      const c = clients.get(ws);
      if (c) c.channels.delete(channelId);
    }
    channels.delete(channelId);
  }

  console.log(
    `[relay] Channel deleted: #${target.name} (${channelId.slice(0, 8)}...) by ${client.username}`
  );

  // Notify all online community members
  const notification = JSON.stringify({
    type: 'CHANNEL_DELETED_EVENT',
    payload: {
      communityId,
      channelId,
      deletedBy: client.username,
    },
    timestamp: Date.now(),
  });

  for (const [ws, c] of clients) {
    if (c.authenticated && communityDB.isMember(communityId, c.publicKey) && ws.readyState === WebSocket.OPEN) {
      ws.send(notification);
    }
  }
}

// =================================================================
// REORDER_CHANNELS
// =================================================================

function handleReorderChannels(
  client: RelayClient,
  msg: any,
  communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  const { communityId, channelIds } = msg.payload || {};

  if (!communityId || !Array.isArray(channelIds) || channelIds.length === 0) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'INVALID', message: 'Community ID and channel IDs array are required' },
      timestamp: Date.now(),
    });
    return;
  }

  // Check permission
  const role = communityDB.getMemberRole(communityId, client.publicKey);
  if (!role || !isAdmin(role)) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'FORBIDDEN', message: 'Only admins and owners can reorder channels' },
      timestamp: Date.now(),
    });
    return;
  }

  communityDB.reorderChannels(communityId, channelIds);

  const updatedChannels = communityDB.getChannels(communityId);

  console.log(
    `[relay] Channels reordered in ${communityId.slice(0, 8)}... by ${client.username}`
  );

  // Notify all online community members
  const notification = JSON.stringify({
    type: 'CHANNELS_REORDERED',
    payload: {
      communityId,
      channels: updatedChannels.map((ch) => ({
        id: ch.id,
        name: ch.name,
        type: ch.type,
        visibility: ch.visibility,
        position: ch.position,
      })),
    },
    timestamp: Date.now(),
  });

  for (const [ws, c] of clients) {
    if (c.authenticated && communityDB.isMember(communityId, c.publicKey) && ws.readyState === WebSocket.OPEN) {
      ws.send(notification);
    }
  }
}
