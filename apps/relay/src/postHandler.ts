/**
 * Post Handler — R12
 *
 * Handles: CREATE_POST, GET_POSTS, DELETE_POST, PIN_POST, ADD_COMMENT, GET_COMMENTS
 */

import { PostDB } from './postDB';
import { CommunityDB } from './communityDB';
import type { RelayClient } from './types';
import { WebSocket } from 'ws';

export function handlePostMessage(
  client: RelayClient,
  msg: any,
  postDB: PostDB,
  communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
  channels: Map<string, Set<WebSocket>>,
): void {
  switch (msg.type) {
    case 'CREATE_POST':   handleCreatePost(client, msg, postDB, communityDB, sendToClient, clients, channels); break;
    case 'GET_POSTS':     handleGetPosts(client, msg, postDB, sendToClient); break;
    case 'DELETE_POST':   handleDeletePost(client, msg, postDB, communityDB, sendToClient, clients, channels); break;
    case 'PIN_POST':      handlePinPost(client, msg, postDB, communityDB, sendToClient, clients, channels); break;
    case 'ADD_COMMENT':   handleAddComment(client, msg, postDB, communityDB, sendToClient, clients, channels); break;
    case 'GET_COMMENTS':  handleGetComments(client, msg, postDB, sendToClient); break;
  }
}

/** Broadcast a message to all subscribers of any channel in a community. */
function broadcastToCommunity(
  communityId: string,
  msg: Record<string, unknown>,
  communityDB: CommunityDB,
  clients: Map<WebSocket, RelayClient>,
  channels: Map<string, Set<WebSocket>>,
  excludeWs?: WebSocket,
): void {
  const community = communityDB.getCommunity(communityId);
  if (!community) return;
  const chList = community.channels || [];
  const sent = new Set<WebSocket>();
  const payload = JSON.stringify(msg);

  for (const ch of chList) {
    const subs = channels.get(ch.id);
    if (!subs) continue;
    for (const ws of subs) {
      if (ws !== excludeWs && !sent.has(ws) && ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        sent.add(ws);
      }
    }
  }
}

function handleCreatePost(
  client: RelayClient, msg: any, postDB: PostDB, communityDB: CommunityDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>, channels: Map<string, Set<WebSocket>>,
): void {
  const { communityId, title, body } = msg.payload || {};
  if (!communityId || !title?.trim()) {
    sendToClient(client, { type: 'POST_RESULT', payload: { action: 'CREATE_POST', success: false, message: 'Title is required.' }, timestamp: Date.now() });
    return;
  }

  // Verify user is a member
  const member = communityDB.getMember(communityId, client.publicKey);
  if (!member) {
    sendToClient(client, { type: 'POST_RESULT', payload: { action: 'CREATE_POST', success: false, message: 'You must be a member to post.' }, timestamp: Date.now() });
    return;
  }

  if (title.trim().length > 200) {
    sendToClient(client, { type: 'POST_RESULT', payload: { action: 'CREATE_POST', success: false, message: 'Title must be 200 characters or fewer.' }, timestamp: Date.now() });
    return;
  }
  if ((body || '').length > 10000) {
    sendToClient(client, { type: 'POST_RESULT', payload: { action: 'CREATE_POST', success: false, message: 'Body must be 10,000 characters or fewer.' }, timestamp: Date.now() });
    return;
  }

  const post = postDB.createPost(communityId, client.publicKey, client.username, title.trim(), (body || '').trim());
  const postPayload = { ...post, pinned: !!post.pinned };

  // Send to creator
  sendToClient(client, { type: 'POST_CREATED', payload: postPayload, timestamp: Date.now() });

  // Broadcast to community members
  broadcastToCommunity(communityId, { type: 'POST_CREATED', payload: postPayload, timestamp: Date.now() }, communityDB, clients, channels, client.ws);
}

function handleGetPosts(
  client: RelayClient, msg: any, postDB: PostDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const { communityId, offset, limit } = msg.payload || {};
  if (!communityId) return;

  const { posts, total } = postDB.getPosts(communityId, offset || 0, limit || 50);
  const mapped = posts.map((p) => ({ ...p, pinned: !!p.pinned }));

  sendToClient(client, { type: 'POST_LIST', payload: { communityId, posts: mapped, total }, timestamp: Date.now() });
}

function handleDeletePost(
  client: RelayClient, msg: any, postDB: PostDB, communityDB: CommunityDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>, channels: Map<string, Set<WebSocket>>,
): void {
  const { communityId, postId } = msg.payload || {};
  if (!communityId || !postId) return;

  const post = postDB.getPost(postId);
  if (!post) {
    sendToClient(client, { type: 'POST_RESULT', payload: { action: 'DELETE_POST', success: false, message: 'Post not found.' }, timestamp: Date.now() });
    return;
  }

  // Only author or admin+ can delete
  const isAuthor = post.authorPublicKey === client.publicKey;
  const member = communityDB.getMember(communityId, client.publicKey);
  const isAdmin = member && (member.role === 'owner' || member.role === 'admin' || member.role === 'moderator');

  if (!isAuthor && !isAdmin) {
    sendToClient(client, { type: 'POST_RESULT', payload: { action: 'DELETE_POST', success: false, message: 'Permission denied.' }, timestamp: Date.now() });
    return;
  }

  postDB.deletePost(postId);
  const deleteMsg = { type: 'POST_DELETED', payload: { communityId, postId }, timestamp: Date.now() };
  sendToClient(client, deleteMsg);
  broadcastToCommunity(communityId, deleteMsg, communityDB, clients, channels, client.ws);
}

function handlePinPost(
  client: RelayClient, msg: any, postDB: PostDB, communityDB: CommunityDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>, channels: Map<string, Set<WebSocket>>,
): void {
  const { communityId, postId, pinned } = msg.payload || {};
  if (!communityId || !postId || pinned === undefined) return;

  // Only admin+ can pin
  const member = communityDB.getMember(communityId, client.publicKey);
  if (!member || (member.role !== 'owner' && member.role !== 'admin' && member.role !== 'moderator')) {
    sendToClient(client, { type: 'POST_RESULT', payload: { action: 'PIN_POST', success: false, message: 'Only admins can pin posts.' }, timestamp: Date.now() });
    return;
  }

  const success = postDB.pinPost(postId, !!pinned);
  if (!success) {
    sendToClient(client, { type: 'POST_RESULT', payload: { action: 'PIN_POST', success: false, message: 'Post not found.' }, timestamp: Date.now() });
    return;
  }

  const pinMsg = { type: 'POST_PINNED', payload: { communityId, postId, pinned: !!pinned }, timestamp: Date.now() };
  sendToClient(client, pinMsg);
  broadcastToCommunity(communityId, pinMsg, communityDB, clients, channels, client.ws);
}

function handleAddComment(
  client: RelayClient, msg: any, postDB: PostDB, communityDB: CommunityDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>, channels: Map<string, Set<WebSocket>>,
): void {
  const { postId, content } = msg.payload || {};
  if (!postId || !content?.trim()) {
    sendToClient(client, { type: 'POST_RESULT', payload: { action: 'ADD_COMMENT', success: false, message: 'Comment cannot be empty.' }, timestamp: Date.now() });
    return;
  }

  if (content.trim().length > 2000) {
    sendToClient(client, { type: 'POST_RESULT', payload: { action: 'ADD_COMMENT', success: false, message: 'Comment must be 2,000 characters or fewer.' }, timestamp: Date.now() });
    return;
  }

  const post = postDB.getPost(postId);
  if (!post) {
    sendToClient(client, { type: 'POST_RESULT', payload: { action: 'ADD_COMMENT', success: false, message: 'Post not found.' }, timestamp: Date.now() });
    return;
  }

  // Verify user is a member of the community
  const member = communityDB.getMember(post.communityId, client.publicKey);
  if (!member) {
    sendToClient(client, { type: 'POST_RESULT', payload: { action: 'ADD_COMMENT', success: false, message: 'You must be a member to comment.' }, timestamp: Date.now() });
    return;
  }

  const comment = postDB.addComment(postId, client.publicKey, client.username, content.trim());
  if (!comment) return;

  const commentMsg = { type: 'COMMENT_ADDED', payload: { ...comment, communityId: post.communityId }, timestamp: Date.now() };
  sendToClient(client, commentMsg);
  broadcastToCommunity(post.communityId, commentMsg, communityDB, clients, channels, client.ws);
}

function handleGetComments(
  client: RelayClient, msg: any, postDB: PostDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const { postId } = msg.payload || {};
  if (!postId) return;

  const comments = postDB.getComments(postId);
  sendToClient(client, { type: 'COMMENT_LIST', payload: { postId, comments }, timestamp: Date.now() });
}
