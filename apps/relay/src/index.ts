/**
 * Muster Relay Server — R2 update
 *
 * Changes from R1:
 * - Messages are stored in SQLite on every PUBLISH
 * - New SYNC_REQUEST handler: returns missed messages since a timestamp
 * - Graceful shutdown closes the database
 * - Stats now include stored message count
 */

import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'crypto';
import { RelayDB } from './database';
import type { RelayClient } from './types';

// -----------------------------------------------------------------
// Signature verification stub — replace with @muster/crypto
// -----------------------------------------------------------------
function verifySignature(
  _message: string,
  _signature: string,
  _publicKey: string
): boolean {
  // TODO: Replace with real Ed25519 verification from @muster/crypto
  return true;
}

// =================================================================
// Configuration
// =================================================================

const PORT = parseInt(process.env.MUSTER_WS_PORT || '4002', 10);
const MAX_MESSAGE_SIZE = 64 * 1024;

// Message retention: 30 days by default (in milliseconds)
const RETENTION_MS = parseInt(process.env.MUSTER_RETENTION_DAYS || '30', 10) * 24 * 60 * 60 * 1000;

// =================================================================
// State
// =================================================================

const clients = new Map<WebSocket, RelayClient>();
const channels = new Map<string, Set<WebSocket>>();
const db = new RelayDB();

// =================================================================
// Server
// =================================================================

const wss = new WebSocketServer({
  port: PORT,
  maxPayload: MAX_MESSAGE_SIZE,
});

console.log(`[relay] ====================================`);
console.log(`[relay]  Muster Relay Node (R2)`);
console.log(`[relay]  Listening on port ${PORT}`);
console.log(`[relay]  Max message size: ${MAX_MESSAGE_SIZE / 1024} KB`);
console.log(`[relay]  Message retention: ${RETENTION_MS / (24*60*60*1000)} days`);
console.log(`[relay]  Stored messages: ${db.getMessageCount()}`);
console.log(`[relay] ====================================`);

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress || 'unknown';
  const challenge = randomBytes(32).toString('hex');

  const client: RelayClient = {
    ws,
    publicKey: '',
    username: '',
    authenticated: false,
    challenge,
    channels: new Set(),
    connectedAt: Date.now(),
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
      const data = raw.toString('utf-8');
      const msg = JSON.parse(data);
      handleMessage(client, msg);
    } catch {
      console.warn(`[relay] Malformed message from ${client.username || ip}`);
    }
  });

  ws.on('close', () => {
    handleDisconnect(client);
    console.log(
      `[relay] Client disconnected: ${client.username || ip}`
      + ` (${clients.size} remaining)`
    );
  });

  ws.on('error', (err) => {
    console.error(`[relay] WebSocket error for ${client.username || ip}:`, err.message);
  });
});

// =================================================================
// Message routing
// =================================================================

function handleMessage(client: RelayClient, msg: any): void {
  switch (msg.type) {
    case 'AUTH_RESPONSE':
      handleAuth(client, msg);
      break;
    case 'SUBSCRIBE':
      if (!requireAuth(client)) return;
      handleSubscribe(client, msg);
      break;
    case 'UNSUBSCRIBE':
      if (!requireAuth(client)) return;
      handleUnsubscribe(client, msg);
      break;
    case 'PUBLISH':
      if (!requireAuth(client)) return;
      handlePublish(client, msg);
      break;
    case 'SYNC_REQUEST':
      if (!requireAuth(client)) return;
      handleSyncRequest(client, msg);
      break;
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
    sendToClient(client, {
      type: 'AUTH_RESULT',
      payload: { success: false, reason: 'Missing publicKey, signature, or username' },
      timestamp: Date.now(),
    });
    client.ws.close(4001, 'auth failed');
    return;
  }

  const valid = verifySignature(client.challenge, signature, publicKey);

  if (!valid) {
    console.warn(`[relay] Auth failed for ${username} — invalid signature`);
    sendToClient(client, {
      type: 'AUTH_RESULT',
      payload: { success: false, reason: 'Invalid signature' },
      timestamp: Date.now(),
    });
    client.ws.close(4001, 'auth failed');
    return;
  }

  client.authenticated = true;
  client.publicKey = publicKey;
  client.username = username;

  console.log(`[relay] Authenticated: ${username} (${publicKey.slice(0, 12)}...)`);

  sendToClient(client, {
    type: 'AUTH_RESULT',
    payload: { success: true },
    timestamp: Date.now(),
  });
}

// =================================================================
// Pub/Sub
// =================================================================

function handleSubscribe(client: RelayClient, msg: any): void {
  const channelIds: string[] = msg.payload?.channels || [];

  for (const channelId of channelIds) {
    client.channels.add(channelId);
    if (!channels.has(channelId)) {
      channels.set(channelId, new Set());
    }
    channels.get(channelId)!.add(client.ws);

    console.log(
      `[relay] ${client.username} subscribed to ${channelId}`
      + ` (${channels.get(channelId)!.size} in channel)`
    );

    broadcastPresence(channelId);
  }
}

function handleUnsubscribe(client: RelayClient, msg: any): void {
  const channelIds: string[] = msg.payload?.channels || [];

  for (const channelId of channelIds) {
    client.channels.delete(channelId);
    channels.get(channelId)?.delete(client.ws);

    if (channels.get(channelId)?.size === 0) {
      channels.delete(channelId);
    } else {
      broadcastPresence(channelId);
    }
  }
}

function handlePublish(client: RelayClient, msg: any): void {
  const { channel, content, messageId, timestamp } = msg.payload || {};

  if (!channel || !content || !messageId) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'INVALID_PUBLISH', message: 'Missing channel, content, or messageId' },
      timestamp: Date.now(),
    });
    return;
  }

  const sigValid = verifySignature(
    JSON.stringify(msg.payload),
    msg.signature || '',
    msg.senderPublicKey || client.publicKey
  );

  if (!sigValid) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'INVALID_SIGNATURE', message: 'Message signature verification failed' },
      timestamp: Date.now(),
    });
    return;
  }

  if (!client.channels.has(channel)) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'NOT_SUBSCRIBED', message: 'You are not subscribed to this channel' },
      timestamp: Date.now(),
    });
    return;
  }

  // ---- R2: Store message in SQLite ----
  db.storeMessage({
    messageId,
    channel,
    content,
    senderPublicKey: client.publicKey,
    senderUsername: client.username,
    timestamp,
    signature: msg.signature || '',
  });

  // Fan-out to all other subscribers
  const subscribers = channels.get(channel);
  if (!subscribers) return;

  const outgoing = JSON.stringify({
    type: 'MESSAGE',
    payload: {
      channel,
      content,
      messageId,
      timestamp,
      senderPublicKey: client.publicKey,
      senderUsername: client.username,
    },
    signature: msg.signature || '',
  });

  let delivered = 0;
  for (const sub of subscribers) {
    if (sub !== client.ws && sub.readyState === WebSocket.OPEN) {
      sub.send(outgoing);
      delivered++;
    }
  }

  console.log(
    `[relay] ${client.username} → #${channel.slice(0, 8)}...`
    + ` (delivered to ${delivered}, stored in DB)`
  );
}

// =================================================================
// Sync — R2
// =================================================================

function handleSyncRequest(client: RelayClient, msg: any): void {
  const { channel, since } = msg.payload || {};

  if (!channel || since === undefined) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'INVALID_SYNC', message: 'Missing channel or since timestamp' },
      timestamp: Date.now(),
    });
    return;
  }

  // Fetch messages from SQLite
  const messages = db.getMessagesSince(channel, since);

  console.log(
    `[relay] Sync: ${client.username} requested #${channel.slice(0, 8)}...`
    + ` since ${new Date(since).toISOString()}`
    + ` → ${messages.length} messages`
  );

  sendToClient(client, {
    type: 'SYNC_RESPONSE',
    payload: {
      channel,
      messages: messages.map((m) => ({
        channel: m.channel,
        content: m.content,
        messageId: m.messageId,
        timestamp: m.timestamp,
        senderPublicKey: m.senderPublicKey,
        senderUsername: m.senderUsername,
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
    const client = clients.get(ws);
    if (client?.authenticated) {
      users.push({
        publicKey: client.publicKey,
        username: client.username,
        status: 'online',
      });
    }
  }

  const presenceMsg = JSON.stringify({
    type: 'PRESENCE',
    payload: { channel: channelId, users },
    timestamp: Date.now(),
  });

  for (const ws of subscribers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(presenceMsg);
    }
  }
}

// =================================================================
// Disconnect
// =================================================================

function handleDisconnect(client: RelayClient): void {
  for (const channelId of client.channels) {
    channels.get(channelId)?.delete(client.ws);
    if (channels.get(channelId)?.size) {
      broadcastPresence(channelId);
    } else {
      channels.delete(channelId);
    }
  }
  clients.delete(client.ws);
}

// =================================================================
// Helpers
// =================================================================

function sendToClient(client: RelayClient, msg: Record<string, unknown>): void {
  if (client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(msg));
  }
}

function requireAuth(client: RelayClient): boolean {
  if (!client.authenticated) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'NOT_AUTHENTICATED', message: 'Authenticate first' },
      timestamp: Date.now(),
    });
    return false;
  }
  return true;
}

// =================================================================
// Maintenance — daily cleanup of old messages
// =================================================================

function cleanupOldMessages(): void {
  const cutoff = Date.now() - RETENTION_MS;
  const deleted = db.deleteOlderThan(cutoff);
  if (deleted > 0) {
    console.log(`[relay] Cleanup: deleted ${deleted} messages older than ${RETENTION_MS / (24*60*60*1000)} days`);
  }
}

// Run cleanup every 6 hours
setInterval(cleanupOldMessages, 6 * 60 * 60 * 1000);

// =================================================================
// Graceful shutdown
// =================================================================

function shutdown(): void {
  console.log('[relay] Shutting down...');
  for (const [ws] of clients) {
    ws.close(1001, 'server shutting down');
  }
  wss.close(() => {
    db.close();
    console.log('[relay] Server closed.');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// =================================================================
// Stats (every 60 seconds)
// =================================================================

setInterval(() => {
  const authClients = [...clients.values()].filter((c) => c.authenticated).length;
  console.log(
    `[relay] Stats: ${clients.size} connections,`
    + ` ${authClients} authenticated,`
    + ` ${channels.size} active channels,`
    + ` ${db.getMessageCount()} stored messages`
  );
}, 60_000);
