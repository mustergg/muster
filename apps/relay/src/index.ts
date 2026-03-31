/**
 * Muster Relay Server — Crypto Integration
 *
 * Changes from R6:
 * - Replaced stub verifySignature with real Ed25519 verification via @muster/crypto
 * - handleAuth and handlePublish now use async verify()
 * - Auth challenge verification is now cryptographically enforced
 */

import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'crypto';
import { RelayDB } from './database';
import { CommunityDB } from './communityDB';
import { DMDB } from './dmDB';
import { UserDB } from './userDB';
import { handleCommunityMessage } from './communityHandler';
import { handleDMMessage } from './dmHandler';
import { handleRoleMessage } from './roleHandler';
import { handleEmailMessage } from './emailHandler';
import { enforceTier } from './tierEnforcement';
import { initCrypto, verifySig as verifySignature } from './relayCrypto';
import type { RelayClient } from './types';

const PORT = parseInt(process.env.MUSTER_WS_PORT || '4002', 10);
const MAX_MESSAGE_SIZE = 64 * 1024;
const RETENTION_MS = parseInt(process.env.MUSTER_RETENTION_DAYS || '30', 10) * 24 * 60 * 60 * 1000;

const clients = new Map<WebSocket, RelayClient>();
const channels = new Map<string, Set<WebSocket>>();
const messageDB = new RelayDB();
const communityDB = new CommunityDB(messageDB.getDatabase());
const dmDB = new DMDB(messageDB.getDatabase());
const userDB = new UserDB(messageDB.getDatabase());

const wss = new WebSocketServer({ port: PORT, maxPayload: MAX_MESSAGE_SIZE });

// Load Ed25519 crypto (async import for ESM/CJS compat)
initCrypto().catch((err) => console.error('[relay] Crypto init failed:', err));

const userCounts = userDB.getUserCount();
console.log(`[relay] ====================================`);
console.log(`[relay]  Muster Relay Node (R6 + Real Crypto)`);
console.log(`[relay]  Listening on port ${PORT}`);
console.log(`[relay]  Ed25519 signature verification: ENABLED`);
console.log(`[relay]  Messages: ${messageDB.getMessageCount()}`);
console.log(`[relay]  DMs: ${dmDB.getCount()}`);
console.log(`[relay]  Communities: ${communityDB.getCommunityCount()}`);
console.log(`[relay]  Users: ${userCounts.total} (${userCounts.verified} verified, ${userCounts.basic} basic)`);
console.log(`[relay] ====================================`);

wss.on('connection', (ws, req) => {
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
const EMAIL_TYPES = new Set(['REGISTER_EMAIL', 'VERIFY_EMAIL', 'RESEND_VERIFICATION', 'ACCOUNT_INFO_REQUEST']);

function handleMessage(client: RelayClient, msg: any): void {
  // Auth is async due to crypto verification
  if (msg.type === 'AUTH_RESPONSE') { handleAuth(client, msg); return; }
  if (!requireAuth(client)) return;

  if (EMAIL_TYPES.has(msg.type)) {
    handleEmailMessage(client, msg, userDB, sendToClient);
    return;
  }

  if (COMMUNITY_TYPES.has(msg.type)) {
    if (msg.type === 'CREATE_COMMUNITY') {
      if (enforceTier(client, 'CREATE_COMMUNITY', userDB, sendToClient)) return;
    }
    handleCommunityMessage(client, msg, communityDB, sendToClient, clients, channels, broadcastPresence);
    return;
  }

  if (DM_TYPES.has(msg.type)) {
    if (msg.type === 'SEND_DM') {
      const recipientKey = msg.payload?.recipientPublicKey;
      if (recipientKey) {
        const history = dmDB.getHistory(client.publicKey, recipientKey, 0, 1);
        const hasExisting = history.length > 0;
        if (enforceTier(client, 'SEND_DM', userDB, sendToClient, { hasExistingConversation: hasExisting })) return;
      }
    }
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

async function handleAuth(client: RelayClient, msg: any): Promise<void> {
  const { publicKey, signature, username } = msg.payload || {};
  if (!publicKey || !signature || !username) {
    sendToClient(client, { type: 'AUTH_RESULT', payload: { success: false, reason: 'Missing fields' }, timestamp: Date.now() });
    client.ws.close(4001);
    return;
  }

  // Real Ed25519 signature verification
  const valid = await verifySignature(client.challenge, signature, publicKey);
  if (!valid) {
    console.warn(`[relay] Auth FAILED for ${username} — invalid signature`);
    sendToClient(client, { type: 'AUTH_RESULT', payload: { success: false, reason: 'Invalid signature' }, timestamp: Date.now() });
    client.ws.close(4001, 'auth failed');
    return;
  }

  client.authenticated = true;
  client.publicKey = publicKey;
  client.username = username;

  const user = userDB.ensureUser(publicKey, username);
  console.log(`[relay] Auth OK: ${username} (${publicKey.slice(0, 12)}...) tier=${user.tier} [Ed25519 verified]`);

  sendToClient(client, { type: 'AUTH_RESULT', payload: { success: true }, timestamp: Date.now() });

  const info = userDB.getAccountInfo(publicKey);
  sendToClient(client, { type: 'ACCOUNT_INFO', payload: info, timestamp: Date.now() });
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

async function handlePublish(client: RelayClient, msg: any): Promise<void> {
  const { channel, content, messageId, timestamp } = msg.payload || {};
  if (!channel || !content || !messageId || !client.channels.has(channel)) return;

  // Verify message signature if provided
  const signature = msg.signature || '';
  if (signature && msg.senderPublicKey) {
    const valid = await verifySignature(JSON.stringify(msg.payload), signature, msg.senderPublicKey);
    if (!valid) {
      console.warn(`[relay] Message signature invalid from ${client.username}`);
      sendToClient(client, { type: 'ERROR', payload: { code: 'INVALID_SIGNATURE', message: 'Message signature verification failed' }, timestamp: Date.now() });
      return;
    }
  }

  messageDB.storeMessage({ messageId, channel, content, senderPublicKey: client.publicKey, senderUsername: client.username, timestamp, signature });

  const outgoing = JSON.stringify({
    type: 'MESSAGE', payload: { channel, content, messageId, timestamp, senderPublicKey: client.publicKey, senderUsername: client.username }, signature,
  });

  const subs = channels.get(channel);
  if (subs) for (const s of subs) { if (s !== client.ws && s.readyState === WebSocket.OPEN) s.send(outgoing); }
}

function handleSyncRequest(client: RelayClient, msg: any): void {
  const { channel, since } = msg.payload || {};
  if (!channel) return;
  const messages = messageDB.getMessagesSince(channel, since || 0);
  sendToClient(client, {
    type: 'SYNC_RESPONSE', payload: { channel, messages: messages.map((m) => ({ channel: m.channel, content: m.content, messageId: m.messageId, timestamp: m.timestamp, senderPublicKey: m.senderPublicKey, senderUsername: m.senderUsername })) }, timestamp: Date.now(),
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

setInterval(() => {
  const msgDeleted = messageDB.deleteOlderThan(Date.now() - RETENTION_MS);
  if (msgDeleted > 0) console.log(`[relay] Cleanup: ${msgDeleted} old msgs`);
  const accDeleted = userDB.deleteExpiredAccounts();
  if (accDeleted > 0) console.log(`[relay] Cleanup: ${accDeleted} expired basic accounts`);
}, 6 * 60 * 60 * 1000);

function shutdown(): void {
  for (const [ws] of clients) ws.close(1001);
  wss.close(() => { messageDB.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

setInterval(() => {
  const auth = [...clients.values()].filter((c) => c.authenticated).length;
  const uc = userDB.getUserCount();
  console.log(
    `[relay] Stats: ${clients.size} conn, ${auth} auth, ${channels.size} ch,`
    + ` ${messageDB.getMessageCount()} msgs, ${dmDB.getCount()} dms,`
    + ` ${communityDB.getCommunityCount()} comm,`
    + ` ${uc.total} users (${uc.verified}v/${uc.basic}b)`
  );
}, 60_000);
