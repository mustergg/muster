/**
 * Muster Relay Server — R3 update
 *
 * Changes from R2:
 * - Community management: CREATE, JOIN, LEAVE, LIST, GET
 * - CommunityDB for SQLite storage of communities and members
 * - Community handler module for clean separation
 */

import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'crypto';
import { RelayDB } from './database';
import { CommunityDB } from './communityDatabase';
import { handleCommunityMessage } from './communityHandler';
import type { RelayClient } from './types';

// Signature verification stub
function verifySignature(
  _message: string,
  _signature: string,
  _publicKey: string
): boolean {
  return true;
}

// =================================================================
// Configuration
// =================================================================

const PORT = parseInt(process.env.MUSTER_WS_PORT || '4002', 10);
const MAX_MESSAGE_SIZE = 64 * 1024;
const RETENTION_MS = parseInt(process.env.MUSTER_RETENTION_DAYS || '30', 10) * 24 * 60 * 60 * 1000;

// =================================================================
// State
// =================================================================

const clients = new Map<WebSocket, RelayClient>();
const channels = new Map<string, Set<WebSocket>>();
const db = new RelayDB();
const communityDB = new CommunityDB(db.getDB());

// =================================================================
// Server
// =================================================================

const wss = new WebSocketServer({ port: PORT, maxPayload: MAX_MESSAGE_SIZE });

console.log(`[relay] ====================================`);
console.log(`[relay]  Muster Relay Node (R3)`);
console.log(`[relay]  Listening on port ${PORT}`);
console.log(`[relay]  Message retention: ${RETENTION_MS / (24*60*60*1000)} days`);
console.log(`[relay]  Stored messages: ${db.getMessageCount()}`);
console.log(`[relay] ====================================`);

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress || 'unknown';
  const challenge = randomBytes(32).toString('hex');

  const client: RelayClient = {
    ws, publicKey: '', username: '', authenticated: false,
    challenge, channels: new Set(), connectedAt: Date.now(),
  };

  clients.set(ws, client);
  console.log(`[relay] Client connected from ${ip} (${clients.size} total)`);

  sendToClient(client, {
    type: 'AUTH_CHALLENGE',
    payload: { challenge },
    timestamp: Date.now(),
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString('utf-8'));
      handleMessage(client, msg);
    } catch {
      console.warn(`[relay] Malformed message from ${client.username || ip}`);
    }
  });

  ws.on('close', () => {
    handleDisconnect(client);
    console.log(`[relay] Client disconnected: ${client.username || ip} (${clients.size} remaining)`);
  });

  ws.on('error', (err) => {
    console.error(`[relay] WS error for ${client.username || ip}:`, err.message);
  });
});

// =================================================================
// Message routing
// =================================================================

function handleMessage(client: RelayClient, msg: any): void {
  // Auth doesn't require authentication
  if (msg.type === 'AUTH_RESPONSE') {
    handleAuth(client, msg);
    return;
  }

  // Everything else requires auth
  if (!requireAuth(client)) return;

  // Try community handler first
  if (handleCommunityMessage(client, msg, communityDB, sendToClient)) return;

  // Then standard message handling
  switch (msg.type) {
    case 'SUBSCRIBE':     handleSubscribe(client, msg); break;
    case 'UNSUBSCRIBE':   handleUnsubscribe(client, msg); break;
    case 'PUBLISH':       handlePublish(client, msg); break;
    case 'SYNC_REQUEST':  handleSyncRequest(client, msg); break;
    default:
      sendToClient(client, {
        type: 'ERROR',
        payload: { code: 'UNKNOWN_TYPE', message: `Unknown message type: ${msg.type}` },
        timestamp: Date.now(),
      });
  }
}

// =================================================================
// Authentication
// =================================================================

function handleAuth(client: RelayClient, msg: any): void {
  const { publicKey, signature, username } = msg.payload || {};
  if (!publicKey || !signature || !username) {
    sendToClient(client, { type: 'AUTH_RESULT', payload: { success: false, reason: 'Missing fields' }, timestamp: Date.now() });
    client.ws.close(4001, 'auth failed');
    return;
  }
  const valid = verifySignature(client.challenge, signature, publicKey);
  if (!valid) {
    sendToClient(client, { type: 'AUTH_RESULT', payload: { success: false, reason: 'Invalid signature' }, timestamp: Date.now() });
    client.ws.close(4001, 'auth failed');
    return;
  }
  client.authenticated = true;
  client.publicKey = publicKey;
  client.username = username;
  console.log(`[relay] Authenticated: ${username} (${publicKey.slice(0, 12)}...)`);
  sendToClient(client, { type: 'AUTH_RESULT', payload: { success: true }, timestamp: Date.now() });
}

// =================================================================
// Pub/Sub
// =================================================================

function handleSubscribe(client: RelayClient, msg: any): void {
  const channelIds: string[] = msg.payload?.channels || [];
  for (const channelId of channelIds) {
    client.channels.add(channelId);
    if (!channels.has(channelId)) channels.set(channelId, new Set());
    channels.get(channelId)!.add(client.ws);
    console.log(`[relay] ${client.username} subscribed to ${channelId.slice(0, 12)}... (${channels.get(channelId)!.size} in channel)`);
    broadcastPresence(channelId);
  }
}

function handleUnsubscribe(client: RelayClient, msg: any): void {
  const channelIds: string[] = msg.payload?.channels || [];
  for (const channelId of channelIds) {
    client.channels.delete(channelId);
    channels.get(channelId)?.delete(client.ws);
    if (channels.get(channelId)?.size === 0) channels.delete(channelId);
    else broadcastPresence(channelId);
  }
}

function handlePublish(client: RelayClient, msg: any): void {
  const { channel, content, messageId, timestamp } = msg.payload || {};
  if (!channel || !content || !messageId) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'INVALID_PUBLISH', message: 'Missing fields' }, timestamp: Date.now() });
    return;
  }
  const sigValid = verifySignature(JSON.stringify(msg.payload), msg.signature || '', msg.senderPublicKey || client.publicKey);
  if (!sigValid) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'INVALID_SIGNATURE', message: 'Signature failed' }, timestamp: Date.now() });
    return;
  }
  if (!client.channels.has(channel)) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'NOT_SUBSCRIBED', message: 'Not subscribed' }, timestamp: Date.now() });
    return;
  }

  db.storeMessage({
    messageId, channel, content,
    senderPublicKey: client.publicKey,
    senderUsername: client.username,
    timestamp, signature: msg.signature || '',
  });

  const subscribers = channels.get(channel);
  if (!subscribers) return;
  const outgoing = JSON.stringify({
    type: 'MESSAGE',
    payload: { channel, content, messageId, timestamp, senderPublicKey: client.publicKey, senderUsername: client.username },
    signature: msg.signature || '',
  });

  let delivered = 0;
  for (const sub of subscribers) {
    if (sub !== client.ws && sub.readyState === WebSocket.OPEN) { sub.send(outgoing); delivered++; }
  }
  console.log(`[relay] ${client.username} → #${channel.slice(0, 8)}... (delivered to ${delivered}, stored)`);
}

// =================================================================
// Sync
// =================================================================

function handleSyncRequest(client: RelayClient, msg: any): void {
  const { channel, since } = msg.payload || {};
  if (!channel || since === undefined) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'INVALID_SYNC', message: 'Missing fields' }, timestamp: Date.now() });
    return;
  }
  const messages = db.getMessagesSince(channel, since);
  console.log(`[relay] Sync: ${client.username} #${channel.slice(0, 8)}... since ${new Date(since).toISOString()} → ${messages.length} msgs`);
  sendToClient(client, {
    type: 'SYNC_RESPONSE',
    payload: {
      channel,
      messages: messages.map((m) => ({
        channel: m.channel, content: m.content, messageId: m.messageId,
        timestamp: m.timestamp, senderPublicKey: m.senderPublicKey, senderUsername: m.senderUsername,
      })),
    },
    timestamp: Date.now(),
  });
}

// =================================================================
// Presence
// =================================================================

function broadcastPresence(channelId: string): void {
  const subscribers = channels.get(channelId);
  if (!subscribers) return;
  const users: Array<{ publicKey: string; username: string; status: string }> = [];
  for (const ws of subscribers) {
    const c = clients.get(ws);
    if (c?.authenticated) users.push({ publicKey: c.publicKey, username: c.username, status: 'online' });
  }
  const presenceMsg = JSON.stringify({ type: 'PRESENCE', payload: { channel: channelId, users }, timestamp: Date.now() });
  for (const ws of subscribers) { if (ws.readyState === WebSocket.OPEN) ws.send(presenceMsg); }
}

// =================================================================
// Disconnect
// =================================================================

function handleDisconnect(client: RelayClient): void {
  for (const channelId of client.channels) {
    channels.get(channelId)?.delete(client.ws);
    if (channels.get(channelId)?.size) broadcastPresence(channelId);
    else channels.delete(channelId);
  }
  clients.delete(client.ws);
}

// =================================================================
// Helpers
// =================================================================

function sendToClient(client: RelayClient, msg: Record<string, unknown>): void {
  if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(msg));
}

function requireAuth(client: RelayClient): boolean {
  if (!client.authenticated) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'NOT_AUTHENTICATED', message: 'Authenticate first' }, timestamp: Date.now() });
    return false;
  }
  return true;
}

// =================================================================
// Maintenance
// =================================================================

function cleanupOldMessages(): void {
  const cutoff = Date.now() - RETENTION_MS;
  const deleted = db.deleteOlderThan(cutoff);
  if (deleted > 0) console.log(`[relay] Cleanup: deleted ${deleted} old messages`);
}
setInterval(cleanupOldMessages, 6 * 60 * 60 * 1000);

// =================================================================
// Shutdown
// =================================================================

function shutdown(): void {
  console.log('[relay] Shutting down...');
  for (const [ws] of clients) ws.close(1001, 'server shutting down');
  wss.close(() => { db.close(); console.log('[relay] Closed.'); process.exit(0); });
  setTimeout(() => process.exit(0), 5000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// =================================================================
// Stats
// =================================================================

setInterval(() => {
  const auth = [...clients.values()].filter((c) => c.authenticated).length;
  console.log(`[relay] Stats: ${clients.size} conn, ${auth} auth, ${channels.size} channels, ${db.getMessageCount()} msgs`);
}, 60_000);
