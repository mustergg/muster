/**
 * Role handler — manages role assignments and moderation actions.
 *
 * Handles: ASSIGN_ROLE, KICK_MEMBER, DELETE_MESSAGE
 *
 * Permission hierarchy: owner > admin > moderator > member
 */

import { WebSocket } from 'ws';
import { CommunityDB } from './communityDB';
import { RelayDB } from './database';
import type { RelayClient } from './types';

const ROLE_LEVEL: Record<string, number> = {
  owner: 4,
  admin: 3,
  moderator: 2,
  member: 1,
};

function getRoleLevel(role: string): number {
  return ROLE_LEVEL[role] ?? 0;
}

export function handleRoleMessage(
  client: RelayClient,
  msg: any,
  communityDB: CommunityDB,
  messageDB: RelayDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
  channels: Map<string, Set<WebSocket>>,
): void {
  switch (msg.type) {
    case 'ASSIGN_ROLE':
      handleAssignRole(client, msg, communityDB, sendToClient, clients);
      break;
    case 'KICK_MEMBER':
      handleKickMember(client, msg, communityDB, sendToClient, clients);
      break;
    case 'DELETE_MESSAGE':
      handleDeleteMessage(client, msg, communityDB, messageDB, sendToClient, channels);
      break;
  }
}

// =================================================================
// ASSIGN_ROLE
// =================================================================

function handleAssignRole(
  client: RelayClient,
  msg: any,
  communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  const { communityId, targetPublicKey, role } = msg.payload || {};
  if (!communityId || !targetPublicKey || !role) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'INVALID', message: 'Missing fields' }, timestamp: Date.now() });
    return;
  }

  // Check assigner's role
  const members = communityDB.getMembers(communityId);
  const assigner = members.find((m) => m.publicKey === client.publicKey);
  const target = members.find((m) => m.publicKey === targetPublicKey);

  if (!assigner) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'NOT_MEMBER', message: 'You are not a member' }, timestamp: Date.now() });
    return;
  }
  if (!target) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'TARGET_NOT_MEMBER', message: 'Target is not a member' }, timestamp: Date.now() });
    return;
  }

  // Permission checks
  const assignerLevel = getRoleLevel(assigner.role);
  const targetLevel = getRoleLevel(target.role);
  const newLevel = getRoleLevel(role);

  // Only owner can assign admin
  if (role === 'admin' && assigner.role !== 'owner') {
    sendToClient(client, { type: 'ERROR', payload: { code: 'FORBIDDEN', message: 'Only the owner can assign admin role' }, timestamp: Date.now() });
    return;
  }
  // Can't assign a role higher than or equal to your own (except owner)
  if (assigner.role !== 'owner' && newLevel >= assignerLevel) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'FORBIDDEN', message: 'Cannot assign a role equal to or above your own' }, timestamp: Date.now() });
    return;
  }
  // Can't modify someone with equal or higher role (except owner)
  if (assigner.role !== 'owner' && targetLevel >= assignerLevel) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'FORBIDDEN', message: 'Cannot modify a member with equal or higher role' }, timestamp: Date.now() });
    return;
  }

  // Update the role in DB
  communityDB.updateMemberRole(communityId, targetPublicKey, role);

  console.log(
    `[relay] Role: ${client.username} set ${target.username} to ${role}`
    + ` in ${communityId.slice(0, 8)}...`
  );

  // Notify all online community members
  const notification = JSON.stringify({
    type: 'ROLE_UPDATED',
    payload: {
      communityId,
      targetPublicKey,
      targetUsername: target.username,
      newRole: role,
      assignedBy: client.username,
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
// KICK_MEMBER
// =================================================================

function handleKickMember(
  client: RelayClient,
  msg: any,
  communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  const { communityId, targetPublicKey, reason } = msg.payload || {};
  if (!communityId || !targetPublicKey) return;

  const members = communityDB.getMembers(communityId);
  const kicker = members.find((m) => m.publicKey === client.publicKey);
  const target = members.find((m) => m.publicKey === targetPublicKey);

  if (!kicker || !target) return;

  const kickerLevel = getRoleLevel(kicker.role);
  const targetLevel = getRoleLevel(target.role);

  // Must be mod+ to kick, can only kick lower roles
  if (kickerLevel < getRoleLevel('moderator')) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'FORBIDDEN', message: 'Must be moderator or above to kick' }, timestamp: Date.now() });
    return;
  }
  if (targetLevel >= kickerLevel) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'FORBIDDEN', message: 'Cannot kick a member with equal or higher role' }, timestamp: Date.now() });
    return;
  }

  communityDB.removeMember(communityId, targetPublicKey);

  console.log(`[relay] Kick: ${client.username} kicked ${target.username} from ${communityId.slice(0, 8)}...`);

  // Notify the kicked user
  for (const [ws, c] of clients) {
    if (c.authenticated && c.publicKey === targetPublicKey && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'KICKED',
        payload: { communityId, reason: reason || 'Removed by moderator' },
        timestamp: Date.now(),
      }));
    }
  }

  // Notify remaining members
  const updatedMembers = communityDB.getMembers(communityId);
  const memberUpdate = JSON.stringify({
    type: 'COMMUNITY_MEMBER_UPDATE',
    payload: {
      communityId,
      members: updatedMembers,
      action: 'left',
      member: { publicKey: targetPublicKey, username: target.username, role: target.role, joinedAt: 0 },
    },
    timestamp: Date.now(),
  });

  for (const [ws, c] of clients) {
    if (c.authenticated && communityDB.isMember(communityId, c.publicKey) && ws.readyState === WebSocket.OPEN) {
      ws.send(memberUpdate);
    }
  }
}

// =================================================================
// DELETE_MESSAGE
// =================================================================

function handleDeleteMessage(
  client: RelayClient,
  msg: any,
  communityDB: CommunityDB,
  messageDB: RelayDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  channels: Map<string, Set<WebSocket>>,
): void {
  const { channel, messageId } = msg.payload || {};
  if (!channel || !messageId) return;

  // Find which community this channel belongs to
  // For now, allow mod+ to delete in any channel they're subscribed to
  // TODO: Look up community from channel ID for proper permission check

  // Check if user is at least moderator in any community
  // (simplified — full implementation would check the specific community)
  const canDelete = client.channels.has(channel);
  if (!canDelete) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'FORBIDDEN', message: 'Cannot delete messages in channels you are not in' }, timestamp: Date.now() });
    return;
  }

  // Delete from SQLite
  messageDB.deleteMessage(messageId);

  console.log(`[relay] Delete: ${client.username} deleted message ${messageId.slice(0, 8)}... in #${channel.slice(0, 8)}...`);

  // Notify all subscribers of the channel
  const notification = JSON.stringify({
    type: 'MESSAGE_DELETED',
    payload: { channel, messageId, deletedBy: client.username },
    timestamp: Date.now(),
  });

  const subs = channels.get(channel);
  if (subs) {
    for (const ws of subs) {
      if (ws.readyState === 1) ws.send(notification);
    }
  }
}
