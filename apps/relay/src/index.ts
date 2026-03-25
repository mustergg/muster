/**
 * Muster Relay Server
 *
 * A lightweight WebSocket server that:
 * 1. Authenticates clients via Ed25519 challenge/response
 * 2. Manages channel subscriptions (pub/sub)
 * 3. Relays signed messages between subscribed clients (fan-out)
 * 4. Broadcasts presence (who is online in each channel)
 *
 * The relay NEVER reads message content — it only verifies signatures
 * and forwards. All messages can be E2E encrypted.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'crypto';
import type { RelayClient } from './types';

// -----------------------------------------------------------------
// NOTE: Adjust this import to match your @muster/crypto package API.
//
// The crypto package should export a function that verifies an
// Ed25519 signature. Common names:
//   verifySignature(message, signature, publicKey) => boolean
//   verify(message, signature, publicKey) => boolean
//
// If your crypto package uses a different name or signature,
// update the verifyClientSignature() helper below.
// -----------------------------------------------------------------
// import { verifySignature } from '@muster/crypto';

// -----------------------------------------------------------------
// TEMPORARY: Stub verification for initial testing.
// Replace this with the real @muster/crypto import once confirmed.
// -----------------------------------------------------------------
function verifySignature(
  _message: string,
  _signature: string,
  _publicKey: string
): boolean {
  // TODO: Replace with real Ed25519 verification from @muster/crypto
  // For initial R1 testing, accept all signatures.
  console.warn('[relay] WARNING: Using stub signature verification — replace with @muster/crypto');
  return true;
}

// =================================================================
// Configuration
// =================================================================

const PORT = parseInt(process.env.MUSTER_WS_PORT || '4002', 10);
const MAX_MESSAGE_SIZE = 64 * 1024; // 64 KB max message size

// =================================================================
// State
// =================================================================

/** All connected clients, keyed by their WebSocket instance. */
const clients = new Map<WebSocket, RelayClient>();

/** Channel subscriptions: channel ID → set of subscribed WebSockets. */
const channels = new Map<string, Set<WebSocket>>();

// =================================================================
// Server
// =================================================================

const wss = new WebSocketServer({
  port: PORT,
  maxPayload: MAX_MESSAGE_SIZE,
});

console.log(`[relay] ====================================`);
console.log(`[relay]  Muster Relay Node`);
console.log(`[relay]  Listening on port ${PORT}`);
console.log(`[relay]  Max message size: ${MAX_MESSAGE_SIZE / 1024} KB`);
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

  // Send auth challenge immediately
  sendToClient(client, {
    type: 'AUTH_CHALLENGE',
    payload: { challenge },
    timestamp: Date.now(),
  });

  // Handle incoming messages
  ws.on('message', (raw) => {
    try {
      const data = raw.toString('utf-8');
      const msg = JSON.parse(data);
      handleMessage(client, msg);
    } catch (err) {
      console.warn(`[relay] Malformed message from ${client.username || ip}`);
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    handleDisconnect(client);
    console.log(
      `[relay] Client disconnected: ${client.username || ip}`
      + ` (${clients.size} remaining)`
    );
  });

  // Handle errors
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

  // Verify: the client signed our challenge with their private key
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

  // Authentication successful
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
    // Add client to channel
    client.channels.add(channelId);
    if (!channels.has(channelId)) {
      channels.set(channelId, new Set());
    }
    channels.get(channelId)!.add(client.ws);

    console.log(
      `[relay] ${client.username} subscribed to ${channelId}`
      + ` (${channels.get(channelId)!.size} in channel)`
    );

    // Broadcast updated presence for this channel
    broadcastPresence(channelId);
  }
}

function handleUnsubscribe(client: RelayClient, msg: any): void {
  const channelIds: string[] = msg.payload?.channels || [];

  for (const channelId of channelIds) {
    client.channels.delete(channelId);
    channels.get(channelId)?.delete(client.ws);

    // Clean up empty channels
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

  // Verify the message signature
  const sigValid = verifySignature(
    JSON.stringify(msg.payload),
    msg.signature || '',
    msg.senderPublicKey || client.publicKey
  );

  if (!sigValid) {
    console.warn(`[relay] Invalid message signature from ${client.username}`);
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'INVALID_SIGNATURE', message: 'Message signature verification failed' },
      timestamp: Date.now(),
    });
    return;
  }

  // Check the sender is subscribed to this channel
  if (!client.channels.has(channel)) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'NOT_SUBSCRIBED', message: 'You are not subscribed to this channel' },
      timestamp: Date.now(),
    });
    return;
  }

  // Fan-out: send MESSAGE to all other subscribers
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
    + ` (delivered to ${delivered} clients)`
  );
}

// =================================================================
// Presence
// =================================================================

function broadcastPresence(channelId: string): void {
  const subscribers = channels.get(channelId);
  if (!subscribers) return;

  // Build list of online users in this channel
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

  // Send presence update to all subscribers
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
// Disconnect cleanup
// =================================================================

function handleDisconnect(client: RelayClient): void {
  // Remove from all channels and broadcast updated presence
  for (const channelId of client.channels) {
    channels.get(channelId)?.delete(client.ws);

    // Broadcast presence update
    if (channels.get(channelId)?.size) {
      broadcastPresence(channelId);
    } else {
      channels.delete(channelId);
    }
  }

  // Remove from clients map
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
// Graceful shutdown
// =================================================================

function shutdown(): void {
  console.log('[relay] Shutting down...');

  // Close all client connections
  for (const [ws] of clients) {
    ws.close(1001, 'server shutting down');
  }

  wss.close(() => {
    console.log('[relay] Server closed.');
    process.exit(0);
  });

  // Force exit after 5 seconds
  setTimeout(() => process.exit(0), 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// =================================================================
// Stats logging (every 60 seconds)
// =================================================================

setInterval(() => {
  const authClients = [...clients.values()].filter((c) => c.authenticated).length;
  console.log(
    `[relay] Stats: ${clients.size} connections,`
    + ` ${authClients} authenticated,`
    + ` ${channels.size} active channels`
  );
}, 60_000);
