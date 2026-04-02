/**
 * Ownership handler — manages ownership transfer and community deletion.
 *
 * Handles: CHECK_TRANSFER_ELIGIBILITY, TRANSFER_OWNERSHIP, DELETE_COMMUNITY_CMD
 *
 * Rules:
 * - Only the owner can transfer ownership or delete the community
 * - Ownership can only be transferred to a verified member
 * - If no verified members exist, owner cannot leave (only delete)
 * - If owner is the only member, only delete is available
 * - Delete removes everything: community, channels, members, messages
 */

import { WebSocket } from 'ws';
import { CommunityDB } from './communityDB';
import { RelayDB } from './database';
import { UserDB } from './userDB';
import type { RelayClient } from './types';

export function handleOwnershipMessage(
  client: RelayClient,
  msg: any,
  communityDB: CommunityDB,
  messageDB: RelayDB,
  userDB: UserDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
  channels: Map<string, Set<WebSocket>>,
): void {
  switch (msg.type) {
    case 'CHECK_TRANSFER_ELIGIBILITY':
      handleCheckEligibility(client, msg, communityDB, userDB, sendToClient);
      break;
    case 'TRANSFER_OWNERSHIP':
      handleTransferOwnership(client, msg, communityDB, userDB, sendToClient, clients);
      break;
    case 'DELETE_COMMUNITY_CMD':
      handleDeleteCommunity(client, msg, communityDB, messageDB, sendToClient, clients, channels);
      break;
  }
}

// =================================================================
// CHECK_TRANSFER_ELIGIBILITY
// =================================================================

function handleCheckEligibility(
  client: RelayClient,
  msg: any,
  communityDB: CommunityDB,
  userDB: UserDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): void {
  const { communityId } = msg.payload || {};
  if (!communityId) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'INVALID', message: 'Community ID is required' }, timestamp: Date.now() });
    return;
  }

  // Verify the requester is the owner
  const community = communityDB.getCommunity(communityId);
  if (!community) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'NOT_FOUND', message: 'Community not found' }, timestamp: Date.now() });
    return;
  }

  if (community.ownerPublicKey !== client.publicKey) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'FORBIDDEN', message: 'Only the owner can check transfer eligibility' }, timestamp: Date.now() });
    return;
  }

  const members = communityDB.getMembers(communityId);
  const totalMembers = members.length;
  const isOnlyMember = totalMembers <= 1;

  // Find verified members excluding the owner
  const eligibleMembers: Array<{ publicKey: string; username: string; role: string }> = [];
  for (const member of members) {
    if (member.publicKey === client.publicKey) continue; // Skip owner
    if (userDB.isVerified(member.publicKey)) {
      eligibleMembers.push({
        publicKey: member.publicKey,
        username: member.username,
        role: member.role,
      });
    }
  }

  sendToClient(client, {
    type: 'TRANSFER_ELIGIBILITY',
    payload: {
      communityId,
      eligibleMembers,
      totalMembers,
      isOnlyMember,
    },
    timestamp: Date.now(),
  });
}

// =================================================================
// TRANSFER_OWNERSHIP
// =================================================================

function handleTransferOwnership(
  client: RelayClient,
  msg: any,
  communityDB: CommunityDB,
  userDB: UserDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  const { communityId, newOwnerPublicKey } = msg.payload || {};
  if (!communityId || !newOwnerPublicKey) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'INVALID', message: 'Community ID and new owner public key are required' }, timestamp: Date.now() });
    return;
  }

  // Verify the requester is the owner
  const community = communityDB.getCommunity(communityId);
  if (!community) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'NOT_FOUND', message: 'Community not found' }, timestamp: Date.now() });
    return;
  }

  if (community.ownerPublicKey !== client.publicKey) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'FORBIDDEN', message: 'Only the owner can transfer ownership' }, timestamp: Date.now() });
    return;
  }

  // Verify target is a member
  if (!communityDB.isMember(communityId, newOwnerPublicKey)) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'TARGET_NOT_MEMBER', message: 'Target user is not a member of this community' }, timestamp: Date.now() });
    return;
  }

  // Verify target is verified
  if (!userDB.isVerified(newOwnerPublicKey)) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'NOT_VERIFIED', message: 'Ownership can only be transferred to verified accounts' }, timestamp: Date.now() });
    return;
  }

  // Find the new owner's username
  const members = communityDB.getMembers(communityId);
  const newOwnerMember = members.find((m) => m.publicKey === newOwnerPublicKey);
  if (!newOwnerMember) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'TARGET_NOT_MEMBER', message: 'Target user not found' }, timestamp: Date.now() });
    return;
  }

  // Perform the transfer
  communityDB.transferOwnership(communityId, client.publicKey, newOwnerPublicKey);

  console.log(
    `[relay] Ownership transferred: "${community.name}" from ${client.username} to ${newOwnerMember.username}`
  );

  // Notify all online community members
  const notification = JSON.stringify({
    type: 'OWNERSHIP_TRANSFERRED',
    payload: {
      communityId,
      previousOwnerPublicKey: client.publicKey,
      previousOwnerUsername: client.username,
      newOwnerPublicKey,
      newOwnerUsername: newOwnerMember.username,
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
// DELETE_COMMUNITY_CMD
// =================================================================

function handleDeleteCommunity(
  client: RelayClient,
  msg: any,
  communityDB: CommunityDB,
  messageDB: RelayDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
  channels: Map<string, Set<WebSocket>>,
): void {
  const { communityId, confirmName } = msg.payload || {};
  if (!communityId || !confirmName) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'INVALID', message: 'Community ID and confirmation name are required' }, timestamp: Date.now() });
    return;
  }

  // Verify the requester is the owner
  const community = communityDB.getCommunity(communityId);
  if (!community) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'NOT_FOUND', message: 'Community not found' }, timestamp: Date.now() });
    return;
  }

  if (community.ownerPublicKey !== client.publicKey) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'FORBIDDEN', message: 'Only the owner can delete the community' }, timestamp: Date.now() });
    return;
  }

  // Verify confirmation name matches
  if (confirmName.trim() !== community.name) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'CONFIRM_MISMATCH', message: 'Community name does not match. Please type the exact name to confirm.' }, timestamp: Date.now() });
    return;
  }

  // Get channel IDs before deletion (for cleanup)
  const communityChannels = communityDB.getChannels(communityId);
  const channelIds = communityChannels.map((ch) => ch.id);

  // Get member list before deletion (for notifications)
  const memberKeys = communityDB.getMembers(communityId).map((m) => m.publicKey);

  // Delete all messages in community channels
  for (const chId of channelIds) {
    messageDB.deleteMessagesByChannel(chId);
  }

  // Delete the community (cascades to channels and members via SQL)
  communityDB.deleteCommunityFull(communityId);

  // Clean up WebSocket channel subscriptions
  for (const chId of channelIds) {
    const subs = channels.get(chId);
    if (subs) {
      for (const ws of subs) {
        const c = clients.get(ws);
        if (c) c.channels.delete(chId);
      }
      channels.delete(chId);
    }
  }

  console.log(
    `[relay] Community deleted: "${community.name}" (${communityId.slice(0, 8)}...) by ${client.username}`
  );

  // Notify all members (including the owner)
  const notification = JSON.stringify({
    type: 'COMMUNITY_DELETED',
    payload: {
      communityId,
      communityName: community.name,
      deletedBy: client.username,
    },
    timestamp: Date.now(),
  });

  for (const [ws, c] of clients) {
    if (c.authenticated && memberKeys.includes(c.publicKey) && ws.readyState === WebSocket.OPEN) {
      ws.send(notification);
    }
  }
}
