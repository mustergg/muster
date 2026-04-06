/**
 * Friend Handler — R11
 *
 * Handles: SEND_FRIEND_REQUEST, RESPOND_FRIEND_REQUEST, REMOVE_FRIEND,
 *          BLOCK_USER, UNBLOCK_USER, GET_FRIENDS, GET_FRIEND_REQUESTS, GET_BLOCKED_USERS
 */

import { FriendDB } from './friendDB';
import { UserDB } from './userDB';
import type { RelayClient } from './types';
import { WebSocket } from 'ws';

export function handleFriendMessage(
  client: RelayClient,
  msg: any,
  friendDB: FriendDB,
  userDB: UserDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  switch (msg.type) {
    case 'SEND_FRIEND_REQUEST':     handleSendRequest(client, msg, friendDB, userDB, sendToClient, clients); break;
    case 'RESPOND_FRIEND_REQUEST':  handleRespondRequest(client, msg, friendDB, sendToClient, clients); break;
    case 'CANCEL_FRIEND_REQUEST':   handleCancelRequest(client, msg, friendDB, sendToClient, clients); break;
    case 'REMOVE_FRIEND':           handleRemoveFriend(client, msg, friendDB, sendToClient, clients); break;
    case 'BLOCK_USER':              handleBlockUser(client, msg, friendDB, sendToClient); break;
    case 'UNBLOCK_USER':            handleUnblockUser(client, msg, friendDB, sendToClient); break;
    case 'GET_FRIENDS':             handleGetFriends(client, friendDB, sendToClient); break;
    case 'GET_FRIEND_REQUESTS':     handleGetFriendRequests(client, friendDB, sendToClient); break;
    case 'GET_BLOCKED_USERS':       handleGetBlockedUsers(client, friendDB, sendToClient); break;
  }
}

function findClientByKey(clients: Map<WebSocket, RelayClient>, publicKey: string): RelayClient | undefined {
  for (const c of clients.values()) {
    if (c.authenticated && c.publicKey === publicKey) return c;
  }
  return undefined;
}

function handleSendRequest(
  client: RelayClient, msg: any, friendDB: FriendDB, userDB: UserDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  const { targetUsername } = msg.payload || {};
  if (!targetUsername) {
    sendToClient(client, { type: 'FRIEND_RESULT', payload: { action: 'SEND_FRIEND_REQUEST', success: false, message: 'Username is required.' }, timestamp: Date.now() });
    return;
  }

  // Only verified users can send friend requests
  if (!userDB.isVerified(client.publicKey)) {
    sendToClient(client, { type: 'FRIEND_RESULT', payload: { action: 'SEND_FRIEND_REQUEST', success: false, message: 'Only verified accounts can send friend requests.' }, timestamp: Date.now() });
    return;
  }

  // Find target user
  const target = friendDB.findUserByUsername(targetUsername);
  if (!target) {
    sendToClient(client, { type: 'FRIEND_RESULT', payload: { action: 'SEND_FRIEND_REQUEST', success: false, message: `User "${targetUsername}" not found.` }, timestamp: Date.now() });
    return;
  }

  // Check if sender is blocked by target
  if (friendDB.isBlocked(target.publicKey, client.publicKey)) {
    sendToClient(client, { type: 'FRIEND_RESULT', payload: { action: 'SEND_FRIEND_REQUEST', success: false, message: 'Cannot send friend request to this user.' }, timestamp: Date.now() });
    return;
  }

  const result = friendDB.sendRequest(client.publicKey, client.username, target.publicKey, target.username);
  if (result.error) {
    sendToClient(client, { type: 'FRIEND_RESULT', payload: { action: 'SEND_FRIEND_REQUEST', success: false, message: result.error }, timestamp: Date.now() });
    return;
  }

  // Confirm to sender
  sendToClient(client, { type: 'FRIEND_RESULT', payload: { action: 'SEND_FRIEND_REQUEST', success: true, message: `Friend request sent to ${targetUsername}.` }, timestamp: Date.now() });

  // Notify target if online
  const targetClient = findClientByKey(clients, target.publicKey);
  if (targetClient) {
    sendToClient(targetClient, { type: 'FRIEND_REQUEST_RECEIVED', payload: result.request, timestamp: Date.now() });
  }
}

function handleRespondRequest(
  client: RelayClient, msg: any, friendDB: FriendDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  const { requestId, action } = msg.payload || {};
  if (!requestId || !action) return;

  const result = friendDB.respondToRequest(requestId, client.publicKey, action);
  if (!result.success) {
    sendToClient(client, { type: 'FRIEND_RESULT', payload: { action: 'RESPOND_FRIEND_REQUEST', success: false, message: result.error }, timestamp: Date.now() });
    return;
  }

  sendToClient(client, { type: 'FRIEND_RESULT', payload: { action: 'RESPOND_FRIEND_REQUEST', success: true, message: action === 'accept' ? 'Friend request accepted!' : action === 'block' ? 'User blocked.' : 'Friend request declined.' }, timestamp: Date.now() });

  if (action === 'accept' && result.request) {
    // Send FRIEND_ADDED to both parties
    const friend1 = { publicKey: result.request.fromPublicKey, username: result.request.fromUsername, displayName: '', since: Date.now() };
    const friend2 = { publicKey: result.request.toPublicKey, username: result.request.toUsername, displayName: '', since: Date.now() };

    sendToClient(client, { type: 'FRIEND_ADDED', payload: friend1, timestamp: Date.now() });

    const senderClient = findClientByKey(clients, result.request.fromPublicKey);
    if (senderClient) {
      sendToClient(senderClient, { type: 'FRIEND_ADDED', payload: friend2, timestamp: Date.now() });
    }
  }
}

function handleCancelRequest(
  client: RelayClient, msg: any, friendDB: FriendDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  const { requestId } = msg.payload || {};
  if (!requestId) return;

  const result = friendDB.cancelRequest(requestId, client.publicKey);
  if (!result.success) {
    sendToClient(client, { type: 'FRIEND_RESULT', payload: { action: 'CANCEL_FRIEND_REQUEST', success: false, message: result.error }, timestamp: Date.now() });
    return;
  }

  sendToClient(client, { type: 'FRIEND_RESULT', payload: { action: 'CANCEL_FRIEND_REQUEST', success: true, message: 'Friend request cancelled.' }, timestamp: Date.now() });

  // Notify the target so their incoming list updates
  if (result.toPublicKey) {
    const targetClient = findClientByKey(clients, result.toPublicKey);
    if (targetClient) {
      sendToClient(targetClient, { type: 'FRIEND_REQUEST_CANCELLED', payload: { requestId }, timestamp: Date.now() });
    }
  }
}

function handleRemoveFriend(
  client: RelayClient, msg: any, friendDB: FriendDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  const { publicKey } = msg.payload || {};
  if (!publicKey) return;

  const removed = friendDB.removeFriend(client.publicKey, publicKey);
  if (!removed) {
    sendToClient(client, { type: 'FRIEND_RESULT', payload: { action: 'REMOVE_FRIEND', success: false, message: 'Not friends with this user.' }, timestamp: Date.now() });
    return;
  }

  sendToClient(client, { type: 'FRIEND_REMOVED', payload: { publicKey }, timestamp: Date.now() });

  // Notify the other user if online
  const otherClient = findClientByKey(clients, publicKey);
  if (otherClient) {
    sendToClient(otherClient, { type: 'FRIEND_REMOVED', payload: { publicKey: client.publicKey }, timestamp: Date.now() });
  }
}

function handleBlockUser(
  client: RelayClient, msg: any, friendDB: FriendDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const { publicKey } = msg.payload || {};
  if (!publicKey) return;
  if (publicKey === client.publicKey) {
    sendToClient(client, { type: 'FRIEND_RESULT', payload: { action: 'BLOCK_USER', success: false, message: 'You cannot block yourself.' }, timestamp: Date.now() });
    return;
  }

  friendDB.blockUser(client.publicKey, publicKey, '');
  sendToClient(client, { type: 'FRIEND_RESULT', payload: { action: 'BLOCK_USER', success: true, message: 'User blocked.' }, timestamp: Date.now() });
}

function handleUnblockUser(
  client: RelayClient, msg: any, friendDB: FriendDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const { publicKey } = msg.payload || {};
  if (!publicKey) return;

  const removed = friendDB.unblockUser(client.publicKey, publicKey);
  sendToClient(client, { type: 'FRIEND_RESULT', payload: { action: 'UNBLOCK_USER', success: removed, message: removed ? 'User unblocked.' : 'User was not blocked.' }, timestamp: Date.now() });
}

function handleGetFriends(
  client: RelayClient, friendDB: FriendDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const friends = friendDB.getFriends(client.publicKey);
  sendToClient(client, { type: 'FRIEND_LIST', payload: { friends }, timestamp: Date.now() });
}

function handleGetFriendRequests(
  client: RelayClient, friendDB: FriendDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const incoming = friendDB.getIncomingRequests(client.publicKey);
  const outgoing = friendDB.getOutgoingRequests(client.publicKey);
  sendToClient(client, { type: 'FRIEND_REQUEST_LIST', payload: { incoming, outgoing }, timestamp: Date.now() });
}

function handleGetBlockedUsers(
  client: RelayClient, friendDB: FriendDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const users = friendDB.getBlockedUsers(client.publicKey);
  sendToClient(client, { type: 'BLOCKED_USERS_LIST', payload: { users }, timestamp: Date.now() });
}
