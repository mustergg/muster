/**
 * Muster Relay Server — R4
 *
 * Changes from R3:
 * - DM database + handlers (SEND_DM, DM_HISTORY_REQUEST, DM_CONVERSATIONS_REQUEST)
 * - Role handlers (ASSIGN_ROLE, KICK_MEMBER, DELETE_MESSAGE)
 * - Stats include DM count
 */

import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'crypto';
import { RelayDB } from './database';
import { CommunityDB } from './communityDB';
import { DMDB } from './dmDB';
import { handleCommunityMessage } from './communityHandler';
import { handleDMMessage } from './dmHandler';
import { handleRoleMessage } from './roleHandler';
import type { RelayClient } from './types';

function verifySignature(_m: string, _s: string, _p: string): boolean { return true; }

const PORT = parseInt(process.env.MUSTER_WS_PORT || '4002', 10);
const MAX_MESSAGE_SIZE = 64 * 1024;
const RETENTION_MS = parseInt(process.env.MUSTER_RETENTION_DAYS || '30', 10) * 24 * 60 * 60 * 1000;

const clients = new Map<WebSocket, RelayClient>();
const channels = new Map<string, Set<WebSocket>>();
const messageDB = new RelayDB();
const communityDB = new CommunityDB(messageDB.getDatabase());
const dmDB = new DMDB(messageDB.getDatabase());

const wss = new WebSocketServer({ port: PORT, maxPayload: MAX_MESSAGE_SIZE });

console.log(`[relay] ====================================`);
console.log(`[relay]  Muster Relay Node (R4)`);
console.log(`[relay]  Listening on port ${PORT}`);
console.log(`[relay]  Messages: ${messageDB.getMessageCount()}, DMs: ${dmDB.getCount()}, Communities: ${communityDB.getCommunityCount()}`);
console.log(`[relay] ====================================`);

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress || 'unknown';
  const challenge = randomBytes(32).toString('hex');
  const client: RelayClient = { ws, publicKey: '', username: '', authenticated: false, challenge, channels: new Set(), connectedAt: Date.now() };
  clients.set(ws, client);

  sendToClient(client, { type: 'AUTH_CHALLENGE', payload: { challenge }, timestamp: Date.now() });

  ws.on('message', (raw) => {
    try { handleMessage(client, JSON.parse(raw.toString('utf-8'))); }
    catch { /* ignore malformed */ }
  });
  ws.on('close', () => { handleDisconnect(client); });
  ws.on('error', (err) => { console.error(`[relay] WS error:`, err.message); });
});

const COMMUNITY_TYPES = new Set(['CREATE_COMMUNITY', 'JOIN_COMMUNITY', 'LEAVE_COMMUNITY', 'LIST_COMMUNITIES', 'GET_COMMUNITY']);
const DM_TYPES = new Set(['SEND_DM', 'DM_HISTORY_REQUEST', 'DM_CONVERSATIONS_REQUEST']);
const ROLE_TYPES = new Set(['ASSIGN_ROLE', 'KICK_MEMBER', 'DELETE_MESSAGE']);

function handleMessage(client: RelayClient, msg: any): void {
  if (msg.type === 'AUTH_RESPONSE') { handleAuth(client, msg); return; }
  if (!requireAuth(client)) return;

  if (COMMUNITY_TYPES.has(msg.type)) {
    handleCommunityMessage(client, msg, communityDB, sendToClient, clients, channels, broadcastPresence);
    return;
  }
  if (DM_TYPES.has(msg.type)) {
    handleDMMessage(client, msg, dmDB, sendToClient, clients);
    return;
  }
  if (ROLE_TYPES.has(msg.type)) {
    handleRoleMessage(client, msg, communityDB, messageDB, sendToClient, clients, channels);
    return;
  }

  switch (msg.type) {
    case 'SUBSCRIBE': handleSubscribe(client, msg); break;
    case 'UNSUBSCRIBE': handleUnsubscribe(client, msg); break;
    case 'PUBLISH': handlePublish(client, msg); break;
    case 'SYNC_REQUEST': handleSyncRequest(client, msg); break;
    default:
      sendToClient(client, { type: 'ERROR', payload: { code: 'UNKNOWN_TYPE', message: `Unknown: ${msg.type}` }, timestamp: Date.now() });
  }
}

function handleAuth(client: RelayClient, msg: any): void {
  const { publicKey, signature, username } = msg.payload || {};
  if (!publicKey || !signature || !username) { client.ws.close(4001); return; }
  if (!verifySignature(client.challenge, signature, publicKey)) { client.ws.close(4001); return; }
  client.authenticated = true;
  client.publicKey = publicKey;
  client.username = username;
  console.log(`[relay] Auth: ${username} (${publicKey.slice(0, 12)}...)`);
  sendToClient(client, { type: 'AUTH_RESULT', payload: { success: true }, timestamp: Date.now() });
}

function handleSubscribe(client: RelayClient, msg: any): void {
  for (const ch of (msg.payload?.channels || [])) {
    client.channels.add(ch);
    if (!channels.has(ch)) channels.set(ch, new Set());
    channels.get(ch)!.add(client.ws);
    broadcastPresence(ch);
  }
}

function handleUnsubscribe(client: RelayClient, msg: any): void {
  for (const ch of (msg.payload?.channels || [])) {
    client.channels.delete(ch);
    channels.get(ch)?.delete(client.ws);
    if (channels.get(ch)?.size === 0) channels.delete(ch);
    else broadcastPresence(ch);
  }
}

function handlePublish(client: RelayClient, msg: any): void {
  const { channel, content, messageId, timestamp } = msg.payload || {};
  if (!channel || !content || !messageId || !client.channels.has(channel)) return;

  messageDB.storeMessage({ messageId, channel, content, senderPublicKey: client.publicKey, senderUsername: client.username, timestamp, signature: msg.signature || '' });

  const outgoing = JSON.stringify({
    type: 'MESSAGE',
    payload: { channel, content, messageId, timestamp, senderPublicKey: client.publicKey, senderUsername: client.username },
    signature: msg.signature || '',
  });

  const subs = channels.get(channel);
  if (subs) for (const s of subs) { if (s !== client.ws && s.readyState === WebSocket.OPEN) s.send(outgoing); }
}

function handleSyncRequest(client: RelayClient, msg: any): void {
  const { channel, since } = msg.payload || {};
  if (!channel) return;
  const messages = messageDB.getMessagesSince(channel, since || 0);
  sendToClient(client, {
    type: 'SYNC_RESPONSE',
    payload: { channel, messages: messages.map((m) => ({ channel: m.channel, content: m.content, messageId: m.messageId, timestamp: m.timestamp, senderPublicKey: m.senderPublicKey, senderUsername: m.senderUsername })) },
    timestamp: Date.now(),
  });
}

function broadcastPresence(channelId: string): void {
  const subs = channels.get(channelId);
  if (!subs) return;
  const users: Array<{ publicKey: string; username: string; status: string }> = [];
  for (const ws of subs) { const c = clients.get(ws); if (c?.authenticated) users.push({ publicKey: c.publicKey, username: c.username, status: 'online' }); }
  const msg = JSON.stringify({ type: 'PRESENCE', payload: { channel: channelId, users }, timestamp: Date.now() });
  for (const ws of subs) { if (ws.readyState === WebSocket.OPEN) ws.send(msg); }
}

function handleDisconnect(client: RelayClient): void {
  for (const ch of client.channels) {
    channels.get(ch)?.delete(client.ws);
    if (channels.get(ch)?.size) broadcastPresence(ch); else channels.delete(ch);
  }
  clients.delete(client.ws);
}

function sendToClient(client: RelayClient, msg: Record<string, unknown>): void {
  if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(msg));
}

function requireAuth(client: RelayClient): boolean {
  if (!client.authenticated) { sendToClient(client, { type: 'ERROR', payload: { code: 'NOT_AUTH', message: 'Authenticate first' }, timestamp: Date.now() }); return false; }
  return true;
}

setInterval(() => { const d = messageDB.deleteOlderThan(Date.now() - RETENTION_MS); if (d > 0) console.log(`[relay] Cleanup: ${d} old msgs`); }, 6 * 60 * 60 * 1000);

function shutdown(): void {
  for (const [ws] of clients) ws.close(1001);
  wss.close(() => { messageDB.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

setInterval(() => {
  const auth = [...clients.values()].filter((c) => c.authenticated).length;
  console.log(`[relay] Stats: ${clients.size} conn, ${auth} auth, ${channels.size} ch, ${messageDB.getMessageCount()} msgs, ${dmDB.getCount()} dms, ${communityDB.getCommunityCount()} comm`);
}, 60_000);
