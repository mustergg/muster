/**
 * Muster Relay Server — R18
 *
 * Changes from R17:
 * - Voice chat via WebRTC (relay as signaling server)
 * - Voice channel state management (join/leave/mute)
 * - P2P audio via mesh topology
 */

import { handleNodeInfoRequest, initNodeInfo } from './nodeInfoHandler';
import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'crypto';
import { RelayDB } from './database';
import { CommunityDB } from './communityDB';
import { DMDB } from './dmDB';
import { UserDB } from './userDB';
import { FileDB } from './fileDB';
import { handleCommunityMessage } from './communityHandler';
import { handleDMMessage } from './dmHandler';
import { handleRoleMessage } from './roleHandler';
import { handleEmailMessage } from './emailHandler';
import { handleChannelMessage } from './channelHandler';
import { handleOwnershipMessage } from './ownershipHandler';
import { handleFileMessage } from './fileHandler';
import { handleProfileMessage } from './profileHandler';
import { PostDB } from './postDB';
import { handlePostMessage } from './postHandler';
import { SquadDB } from './squadDB';
import { handleSquadMessage, cleanupSquadSubscriptions } from './squadHandler';
import { handleVoiceMessage, cleanupVoiceParticipant, getVoiceStats } from './voiceHandler';
import { FriendDB } from './friendDB';
import { handleFriendMessage } from './friendHandler';
import { NodeDB } from './nodeDB';
import { PeerManager } from './peerManager';
import { AdminBot, NODE_BOT_KEY } from './adminBot';
import { getCurrentVersion, getGitBranch, getGitCommit } from './nodeUpdater';
import { enforceTier } from './tierEnforcement';
import { initCrypto, verifySig as verifySignature } from './relayCrypto';
import type { RelayClient } from './types';
import { TierManager } from './nodeTier';
import { handleTierMessage } from './tierHandler';
import { GroupKeyDB } from './groupKeyDB';
import { handleGroupKeyMessage } from './groupKeyHandler';
import { registerProxiedNode, handlePortCheck, getProxyStats } from './wsRelay';
// R25 — Phase 1: two-layer envelope + blob model (gated by MUSTER_TWO_LAYER=1)
import { EnvelopeDB } from './envelopeDB';
import { BlobDB } from './blobDB';
import { handleEnvelopeMessage } from './envelopeHandler';
import { runTwoLayerMigration } from './twoLayerMigration';
// R25 — Phase 2: signed community manifests
import { ManifestDB } from './manifestDB';
import { handleManifestMessage } from './manifestHandler';
// R25 — Phase 3: causal admin op log
import { OpLogDB } from './opLogDB';
import { handleOpMessage } from './opHandler';
// R25 — Phase 4: tier-aware piece eviction
import { PieceEvictor, formatBytes } from './pieceEviction';
// R25 — Phase 5: BitSwap-lite swarm
import { SwarmManager } from './swarmHandler';


const PORT = parseInt(process.env.MUSTER_WS_PORT || '4002', 10);
const MAX_MESSAGE_SIZE = 2 * 1024 * 1024;
const RETENTION_MS = parseInt(process.env.MUSTER_RETENTION_DAYS || '30', 10) * 24 * 60 * 60 * 1000;
const NODE_URL = process.env.MUSTER_NODE_URL || `ws://0.0.0.0:${PORT}`;

const clients = new Map<WebSocket, RelayClient>();
const channels = new Map<string, Set<WebSocket>>();
const messageDB = new RelayDB();
const groupKeyDB = new GroupKeyDB(messageDB.getDatabase());
const communityDB = new CommunityDB(messageDB.getDatabase());
const dmDB = new DMDB(messageDB.getDatabase());
const userDB = new UserDB(messageDB.getDatabase());
const fileDB = new FileDB(messageDB.getDatabase());
const friendDB = new FriendDB(messageDB.getDatabase());
const postDB = new PostDB(messageDB.getDatabase());
const squadDB = new SquadDB(messageDB.getDatabase());
const nodeDB = new NodeDB(messageDB.getDatabase());
const tierManager = new TierManager(nodeDB);
tierManager.autoHostAll(communityDB);
tierManager.startPurgeScheduler(messageDB, dmDB);

initNodeInfo(nodeDB);
const peerManager = new PeerManager(nodeDB, messageDB, communityDB, dmDB, NODE_URL);

// R25 — Phase 1: two-layer envelope/blob storage. Disabled by default;
// flip MUSTER_TWO_LAYER=1 to enable the new path alongside the legacy one.
const TWO_LAYER_ENABLED = process.env.MUSTER_TWO_LAYER === '1';
const envelopeDB = TWO_LAYER_ENABLED ? new EnvelopeDB(messageDB.getDatabase()) : null;
const blobDB = TWO_LAYER_ENABLED ? new BlobDB(messageDB.getDatabase()) : null;
const manifestDB = TWO_LAYER_ENABLED ? new ManifestDB(messageDB.getDatabase()) : null;
const opLogDB = TWO_LAYER_ENABLED ? new OpLogDB(messageDB.getDatabase()) : null;
const pieceEvictor = TWO_LAYER_ENABLED && envelopeDB && blobDB
  ? new PieceEvictor(messageDB.getDatabase(), blobDB, envelopeDB, tierManager)
  : null;
const swarmManager = TWO_LAYER_ENABLED && blobDB && opLogDB
  ? new SwarmManager(peerManager, blobDB, opLogDB, nodeDB.getNodeId())
  : null;
if (TWO_LAYER_ENABLED) {
  console.log('[relay] Two-layer envelope+blob model ENABLED (MUSTER_TWO_LAYER=1)');
  console.log(`[relay]   manifests on file: ${manifestDB?.count() ?? 0}`);
  console.log(`[relay]   admin ops on file: ${opLogDB?.count() ?? 0}`);
  if (pieceEvictor) {
    try {
      const s = pieceEvictor.stats();
      console.log(`[relay]   piece usage: ${formatBytes(s.totalBytes)} total, ${formatBytes(s.pinnedBytes)} pinned, ${formatBytes(s.cacheBytes)} cache (caps ${formatBytes(s.pinnedCap)}/${formatBytes(s.cacheCap)})`);
    } catch (err) {
      console.warn('[relay]   piece stats unavailable:', (err as Error).message);
    }
    pieceEvictor.start();
  }
  if (swarmManager) {
    swarmManager.start();
    console.log('[relay]   swarm: BitSwap-lite ENABLED');
  }
  try {
    const r = runTwoLayerMigration(messageDB.getDatabase());
    if (r.ran) {
      console.log(`[relay] two-layer migration: imported=${r.imported} skipped=${r.skipped} (${r.durationMs}ms)`);
    } else {
      console.log('[relay] two-layer migration: already applied');
    }
  } catch (err) {
    console.error('[relay] two-layer migration FAILED:', err);
  }
}

const adminBot = new AdminBot({
  nodeDB, messageDB, communityDB, dmDB, userDB, fileDB, postDB, squadDB,
  sendToClient,
  getClientCount: () => clients.size,
  getChannelCount: () => channels.size,
  getPeerCount: () => peerManager.getConnectedPeerCount(),
  getPeerVersions: () => peerManager.getPeerVersions(),
});

const wss = new WebSocketServer({ port: PORT, maxPayload: MAX_MESSAGE_SIZE });

initCrypto().catch((err) => console.error('[relay] Crypto init failed:', err));

const userCounts = userDB.getUserCount();
const fileTotalKB = Math.round(fileDB.getTotalSize() / 1024);
console.log(`[relay] ====================================`);
console.log(`[relay]  Muster Relay Node (R21)`);
console.log(`[relay]  Tier: ${tierManager.getTier()}`);
console.log(`[relay]  Version: ${getCurrentVersion()} (${getGitBranch()}@${getGitCommit()})`);
console.log(`[relay]  Node ID: ${nodeDB.getNodeId().slice(0, 20)}...`);
console.log(`[relay]  Node URL: ${NODE_URL}`);
console.log(`[relay]  Listening on port ${PORT}`);
console.log(`[relay]  Ed25519 signature verification: ENABLED`);
console.log(`[relay]  Messages: ${messageDB.getMessageCount()}`);
console.log(`[relay]  DMs: ${dmDB.getCount()}`);
console.log(`[relay]  Files: ${fileDB.getCount()} (${fileTotalKB}KB)`);
console.log(`[relay]  Communities: ${communityDB.getCommunityCount()}`);
console.log(`[relay]  Users: ${userCounts.total} (${userCounts.verified} verified, ${userCounts.basic} basic)`);
console.log(`[relay]  Known peers: ${nodeDB.getPeerCount()}`);
console.log(`[relay] ====================================`);

// Start peer-to-peer connections
peerManager.start();

wss.on('connection', (ws) => {
  const challenge = randomBytes(32).toString('hex');
  const client: RelayClient = { ws, publicKey: '', username: '', authenticated: false, challenge, channels: new Set(), connectedAt: Date.now() };
  clients.set(ws, client);
  sendToClient(client, { type: 'AUTH_CHALLENGE', payload: { challenge }, timestamp: Date.now() });
  ws.on('message', (raw) => { try { handleMessage(client, JSON.parse(raw.toString('utf-8'))); } catch { /* ignore */ } });
  ws.on('close', () => { handleDisconnect(client); });
  ws.on('error', (err) => { console.error(`[relay] WS error:`, err.message); });
});

const COMMUNITY_TYPES = new Set(['CREATE_COMMUNITY', 'JOIN_COMMUNITY', 'LEAVE_COMMUNITY', 'LIST_COMMUNITIES', 'GET_COMMUNITY']);
const DM_TYPES = new Set(['SEND_DM', 'DM_HISTORY_REQUEST', 'DM_CONVERSATIONS_REQUEST']);
const ROLE_TYPES = new Set(['ASSIGN_ROLE', 'KICK_MEMBER', 'DELETE_MESSAGE']);
const EMAIL_TYPES = new Set(['REGISTER_EMAIL', 'VERIFY_EMAIL', 'RESEND_VERIFICATION', 'ACCOUNT_INFO_REQUEST']);
const CHANNEL_TYPES = new Set(['CREATE_CHANNEL', 'EDIT_CHANNEL', 'DELETE_CHANNEL_CMD', 'REORDER_CHANNELS']);
const OWNERSHIP_TYPES = new Set(['CHECK_TRANSFER_ELIGIBILITY', 'TRANSFER_OWNERSHIP', 'DELETE_COMMUNITY_CMD']);
const FILE_TYPES = new Set(['UPLOAD_FILE', 'REQUEST_FILE']);
const PROFILE_TYPES = new Set(['UPDATE_PROFILE', 'GET_PROFILE']);
const FRIEND_TYPES = new Set(['SEND_FRIEND_REQUEST', 'RESPOND_FRIEND_REQUEST', 'CANCEL_FRIEND_REQUEST', 'REMOVE_FRIEND', 'BLOCK_USER', 'UNBLOCK_USER', 'GET_FRIENDS', 'GET_FRIEND_REQUESTS', 'GET_BLOCKED_USERS']);
const POST_TYPES = new Set(['CREATE_POST', 'GET_POSTS', 'DELETE_POST', 'PIN_POST', 'ADD_COMMENT', 'GET_COMMENTS']);
const SQUAD_TYPES = new Set(['CREATE_SQUAD', 'GET_SQUADS', 'INVITE_TO_SQUAD', 'LEAVE_SQUAD', 'KICK_FROM_SQUAD', 'DELETE_SQUAD', 'GET_SQUAD_MEMBERS', 'SUBSCRIBE_SQUAD', 'SEND_SQUAD_MESSAGE', 'SQUAD_HISTORY_REQUEST']);
const VOICE_TYPES = new Set(['VOICE_JOIN', 'VOICE_LEAVE', 'VOICE_SIGNAL', 'VOICE_ICE_CANDIDATE', 'VOICE_MUTE']);
const TIER_TYPES = new Set(['GET_STORAGE_STATS', 'STORAGE_PREFERENCE', 'CLEAR_CACHE']);

function handleMessage(client: RelayClient, msg: any): void {

  if (msg.type === 'PORT_CHECK_REQUEST') { handlePortCheck(client, msg, sendToClient); return; }
  
  // Peer-to-peer: handle node handshake (before auth check)
  if (msg.type === 'NODE_HANDSHAKE') { peerManager.handleInboundHandshake(client.ws, msg); return; }

  if (msg.type === 'AUTH_RESPONSE') { handleAuth(client, msg); return; }
  if (!requireAuth(client)) return;

  // R25 — two-layer dispatch (gated). Falls through to legacy when disabled.
  if (TWO_LAYER_ENABLED && envelopeDB && blobDB && manifestDB && opLogDB) {
    if (handleManifestMessage(client, msg, manifestDB, sendToClient, clients)) return;
    if (handleOpMessage(client, msg, opLogDB, manifestDB, sendToClient, clients)) return;
    if (handleEnvelopeMessage(client, msg, envelopeDB, blobDB, manifestDB, sendToClient, channels, clients)) return;
  }

  // Client requests list of known nodes
  if (msg.type === 'GET_NODES') { sendToClient(client, { type: 'NODE_LIST', payload: {tier: tierManager.getTier(), nodes: peerManager.getNodeList() }, timestamp: Date.now() }); return; }
  if (msg.type === 'GET_NODE_INFO' || msg.type === 'GET_NODE_PEERS') {
    handleNodeInfoRequest(client, msg, nodeDB, sendToClient);
    
    return;
  }

  if (EMAIL_TYPES.has(msg.type)) { handleEmailMessage(client, msg, userDB, sendToClient); return; }
  if (PROFILE_TYPES.has(msg.type)) { handleProfileMessage(client, msg, userDB, sendToClient); return; }
  if (FRIEND_TYPES.has(msg.type)) { handleFriendMessage(client, msg, friendDB, userDB, sendToClient, clients); return; }
  if (POST_TYPES.has(msg.type)) { handlePostMessage(client, msg, postDB, communityDB, sendToClient, clients, channels); return; }
  if (SQUAD_TYPES.has(msg.type)) { handleSquadMessage(client, msg, squadDB, userDB, communityDB, sendToClient, clients); return; }
  if (VOICE_TYPES.has(msg.type)) { handleVoiceMessage(client, msg, sendToClient, clients); return; }
  if (OWNERSHIP_TYPES.has(msg.type)) { handleOwnershipMessage(client, msg, communityDB, messageDB, userDB, sendToClient, clients, channels); return; }

  if (COMMUNITY_TYPES.has(msg.type)) {
    if (msg.type === 'CREATE_COMMUNITY') { if (enforceTier(client, 'CREATE_COMMUNITY', userDB, sendToClient)) return; }
    handleCommunityMessage(client, msg, communityDB, sendToClient, clients, channels, broadcastPresence, userDB);
    return;
  }

  if (CHANNEL_TYPES.has(msg.type)) { handleChannelMessage(client, msg, communityDB, sendToClient, clients, channels, broadcastPresence); return; }
  if (FILE_TYPES.has(msg.type)) { handleFileMessage(client, msg, fileDB, sendToClient, clients, channels); return; }

  if (DM_TYPES.has(msg.type)) {
    if (msg.type === 'SEND_DM') {
      const recipientKey = msg.payload?.recipientPublicKey;
      // R16: Intercept DMs to the node bot
      if (recipientKey === NODE_BOT_KEY) {
        adminBot.handleMessage(client, msg.payload?.content || '');
        return;
      }
      if (recipientKey) {
        const history = dmDB.getHistory(client.publicKey, recipientKey, 0, 1);
        if (enforceTier(client, 'SEND_DM', userDB, sendToClient, { hasExistingConversation: history.length > 0 })) return;
      }
    }
    handleDMMessage(client, msg, dmDB, sendToClient, clients);
    // R16: After DM conversations load, inject bot welcome for admin
    if (msg.type === 'DM_CONVERSATIONS_REQUEST' && adminBot.isAdmin(client.publicKey)) {
      setTimeout(() => adminBot.sendWelcome(client), 200);
    }
    return;
  }

  if (TIER_TYPES.has(msg.type)) { handleTierMessage(client, msg, tierManager, messageDB, communityDB, dmDB, sendToClient); return; }
  if (ROLE_TYPES.has(msg.type)) { handleRoleMessage(client, msg, communityDB, messageDB, sendToClient, clients, channels); return; }

const GROUP_KEY_TYPES = new Set(['GROUP_KEY_REQUEST', 'GROUP_KEY_DISTRIBUTE', 'GROUP_KEY_ROTATE', 'GROUP_CRYPTO_CONFIG']);
if (GROUP_KEY_TYPES.has(msg.type)) {
  handleGroupKeyMessage(client, msg, groupKeyDB, communityDB, sendToClient, clients);
  return;
}


  switch (msg.type) {
    case 'SUBSCRIBE': handleSubscribe(client, msg); break;
    case 'UNSUBSCRIBE': handleUnsubscribe(client, msg); break;
    case 'PUBLISH': handlePublish(client, msg); break;
    case 'SYNC_REQUEST': handleSyncRequest(client, msg); break;
    default: sendToClient(client, { type: 'ERROR', payload: { code: 'UNKNOWN_TYPE', message: `Unknown: ${msg.type}` }, timestamp: Date.now() });
  }
}

async function handleAuth(client: RelayClient, msg: any): Promise<void> {
  const { publicKey, signature, username, authMode } = msg.payload || {};
  if (!publicKey || !signature || !username) { sendToClient(client, { type: 'AUTH_RESULT', payload: { success: false, reason: 'Missing fields' }, timestamp: Date.now() }); client.ws.close(4001); return; }
  const valid = await verifySignature(client.challenge, signature, publicKey);
  if (!valid) { console.warn(`[relay] Auth FAILED for ${username}`); sendToClient(client, { type: 'AUTH_RESULT', payload: { success: false, reason: 'Invalid signature' }, timestamp: Date.now() }); client.ws.close(4001); return; }

  // Check username uniqueness — reject if taken by a different keypair
  const existingByName = userDB.getUserByUsername(username);
  if (existingByName && existingByName.publicKey !== publicKey) {
    const reason = authMode === 'login' ? 'Wrong password.' : 'Username already taken by another account.';
    console.warn(`[relay] Auth REJECTED: username "${username}" — ${reason}`);
    sendToClient(client, { type: 'AUTH_RESULT', payload: { success: false, reason }, timestamp: Date.now() });
    client.ws.close(4001);
    return;
  }

  // Login mode: account must already exist on relay
  if (authMode === 'login') {
    const existingByKey = userDB.getUser(publicKey);
    if (!existingByKey && !existingByName) {
      console.warn(`[relay] Login REJECTED: account "${username}" does not exist`);
      sendToClient(client, { type: 'AUTH_RESULT', payload: { success: false, reason: 'Account not found. Please create an account first.' }, timestamp: Date.now() });
      client.ws.close(4001);
      return;
    }
  }

  client.authenticated = true; client.publicKey = publicKey; client.username = username;
  const user = userDB.ensureUser(publicKey, username);
  console.log(`[relay] Auth OK: ${username} (${publicKey.slice(0, 12)}...) tier=${user.tier} mode=${authMode || 'legacy'}`);
  sendToClient(client, { type: 'AUTH_RESULT', payload: { success: true }, timestamp: Date.now() });
  sendToClient(client, { type: 'ACCOUNT_INFO', payload: userDB.getAccountInfo(publicKey), timestamp: Date.now() });
}

function handleSubscribe(client: RelayClient, msg: any): void { for (const ch of (msg.payload?.channels || [])) { client.channels.add(ch); if (!channels.has(ch)) channels.set(ch, new Set()); channels.get(ch)!.add(client.ws); broadcastPresence(ch); } }
function handleUnsubscribe(client: RelayClient, msg: any): void { for (const ch of (msg.payload?.channels || [])) { client.channels.delete(ch); channels.get(ch)?.delete(client.ws); if (channels.get(ch)?.size === 0) channels.delete(ch); else broadcastPresence(ch); } }

async function handlePublish(client: RelayClient, msg: any): Promise<void> {
  const { channel, content, messageId, timestamp } = msg.payload || {};
  if (!channel || !content || !messageId || !client.channels.has(channel)) return;
  const signature = msg.signature || '';
  if (signature && msg.senderPublicKey) { const valid = await verifySignature(JSON.stringify(msg.payload), signature, msg.senderPublicKey); if (!valid) { sendToClient(client, { type: 'ERROR', payload: { code: 'INVALID_SIGNATURE', message: 'Signature failed' }, timestamp: Date.now() }); return; } }
  messageDB.storeMessage({ messageId, channel, content, senderPublicKey: client.publicKey, senderUsername: client.username, timestamp, signature });
  const outgoing = JSON.stringify({ type: 'MESSAGE', payload: { channel, content, messageId, timestamp, senderPublicKey: client.publicKey, senderUsername: client.username }, signature });
  const subs = channels.get(channel);
  if (subs) for (const s of subs) { if (s !== client.ws && s.readyState === WebSocket.OPEN) s.send(outgoing); }

  // R15: Forward to peer nodes for replication
  // Find which community this channel belongs to
  try {
    const allCommunities = communityDB.getAllCommunityIds();
    for (const cid of allCommunities) {
      const cChannels = communityDB.getChannels(cid);
      if (cChannels.some((ch) => ch.id === channel)) {
        peerManager.forwardMessage(cid, { messageId, channel, content, senderPublicKey: client.publicKey, senderUsername: client.username, timestamp, signature });
        break;
      }
    }
  } catch { /* ignore forwarding errors */ }
}

function handleSyncRequest(client: RelayClient, msg: any): void {
  const { channel, since } = msg.payload || {};
  if (!channel) return;
  const messages = messageDB.getMessagesSince(channel, since || 0);
  sendToClient(client, { type: 'SYNC_RESPONSE', payload: { channel, messages: messages.map((m) => ({ channel: m.channel, content: m.content, messageId: m.messageId, timestamp: m.timestamp, senderPublicKey: m.senderPublicKey, senderUsername: m.senderUsername })) }, timestamp: Date.now() });
}

function broadcastPresence(channelId: string): void {
  const subs = channels.get(channelId); if (!subs) return;
  const users: Array<{ publicKey: string; username: string; status: string }> = [];
  for (const ws of subs) { const c = clients.get(ws); if (c?.authenticated) users.push({ publicKey: c.publicKey, username: c.username, status: 'online' }); }
  const msg = JSON.stringify({ type: 'PRESENCE', payload: { channel: channelId, users }, timestamp: Date.now() });
  for (const ws of subs) { if (ws.readyState === WebSocket.OPEN) ws.send(msg); }
}

function handleDisconnect(client: RelayClient): void { for (const ch of client.channels) { channels.get(ch)?.delete(client.ws); if (channels.get(ch)?.size) broadcastPresence(ch); else channels.delete(ch); } cleanupSquadSubscriptions(client.ws); cleanupVoiceParticipant(client.ws, clients); clients.delete(client.ws); }
function sendToClient(client: RelayClient, msg: Record<string, unknown>): void { if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(msg)); }
function requireAuth(client: RelayClient): boolean { if (!client.authenticated) { sendToClient(client, { type: 'ERROR', payload: { code: 'NOT_AUTH', message: 'Authenticate first' }, timestamp: Date.now() }); return false; } return true; }

setInterval(() => {
  const msgDel = messageDB.deleteOlderThan(Date.now() - RETENTION_MS); if (msgDel > 0) console.log(`[relay] Cleanup: ${msgDel} old msgs`);
  const fileDel = fileDB.deleteOlderThan(Date.now() - RETENTION_MS); if (fileDel > 0) console.log(`[relay] Cleanup: ${fileDel} old files`);
  const accDel = userDB.deleteExpiredAccounts(); if (accDel > 0) console.log(`[relay] Cleanup: ${accDel} expired accounts`);
  const frDel = friendDB.cleanupExpiredRequests(); if (frDel > 0) console.log(`[relay] Cleanup: ${frDel} expired friend requests`);
}, 6 * 60 * 60 * 1000);

function shutdown(): void { swarmManager?.stop(); pieceEvictor?.stop(); peerManager.stop(); for (const [ws] of clients) ws.close(1001); wss.close(() => { messageDB.close(); process.exit(0); }); setTimeout(() => process.exit(0), 5000); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

setInterval(() => {
  const auth = [...clients.values()].filter((c) => c.authenticated).length; const uc = userDB.getUserCount();
  console.log(`[relay] Stats: ${clients.size} conn, ${auth} auth, ${channels.size} ch, ${messageDB.getMessageCount()} msgs, ${dmDB.getCount()} dms, ${fileDB.getCount()} files, ${communityDB.getCommunityCount()} comm, ${uc.total} users (${uc.verified}v/${uc.basic}b), ${peerManager.getConnectedPeerCount()} peers`);
}, 60_000);
