/**
 * Voice Handler — R18
 *
 * Manages voice channel state and WebRTC signaling.
 * The relay does NOT process audio — it only forwards signaling messages
 * so peers can establish direct P2P WebRTC connections.
 *
 * Voice channel state:
 *   channelId → Set of { publicKey, username, muted, ws }
 */

import { WebSocket } from 'ws';
import type { RelayClient } from './types';

interface VoiceParticipant {
  publicKey: string;
  username: string;
  muted: boolean;
  ws: WebSocket;
}

/** Voice channel state: channelId → participants. */
const voiceChannels = new Map<string, Map<string, VoiceParticipant>>();

/** Track which channel each user is in (one channel at a time). */
const userChannel = new Map<string, string>();

export function handleVoiceMessage(
  client: RelayClient,
  msg: any,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  switch (msg.type) {
    case 'VOICE_JOIN':          handleJoin(client, msg, sendToClient, clients); break;
    case 'VOICE_LEAVE':         handleLeave(client, msg, sendToClient, clients); break;
    case 'VOICE_SIGNAL':        handleSignal(client, msg); break;
    case 'VOICE_ICE_CANDIDATE': handleIceCandidate(client, msg); break;
    case 'VOICE_MUTE':          handleMute(client, msg, clients); break;
  }
}

/** Clean up when a client disconnects. */
export function cleanupVoiceParticipant(ws: WebSocket, clients: Map<WebSocket, RelayClient>): void {
  const client = clients.get(ws);
  if (!client) return;

  const channelId = userChannel.get(client.publicKey);
  if (!channelId) return;

  removeFromChannel(client, channelId, clients);
}

// =================================================================
// Handlers
// =================================================================

function handleJoin(
  client: RelayClient, msg: any,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  const { channelId } = msg.payload || {};
  if (!channelId) return;

  // Leave current channel if in one
  const currentChannel = userChannel.get(client.publicKey);
  if (currentChannel && currentChannel !== channelId) {
    removeFromChannel(client, currentChannel, clients);
  }

  // Join new channel
  if (!voiceChannels.has(channelId)) {
    voiceChannels.set(channelId, new Map());
  }

  const channel = voiceChannels.get(channelId)!;

  // Don't double-join
  if (channel.has(client.publicKey)) return;

  const participant: VoiceParticipant = {
    publicKey: client.publicKey,
    username: client.username,
    muted: false,
    ws: client.ws,
  };

  channel.set(client.publicKey, participant);
  userChannel.set(client.publicKey, channelId);

  console.log(`[voice] ${client.username} joined voice channel ${channelId.slice(0, 12)} (${channel.size} participants)`);

  // Notify all participants (including the joiner) with current state
  broadcastVoiceState(channelId, clients);

  // Notify existing participants that a new user joined (so they send offers)
  for (const [key, p] of channel) {
    if (key !== client.publicKey && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(JSON.stringify({
        type: 'VOICE_USER_JOINED',
        payload: { channelId, publicKey: client.publicKey, username: client.username },
        timestamp: Date.now(),
      }));
    }
  }
}

function handleLeave(
  client: RelayClient, msg: any,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  const { channelId } = msg.payload || {};
  if (!channelId) return;
  removeFromChannel(client, channelId, clients);
}

function handleSignal(client: RelayClient, msg: any): void {
  const { targetPublicKey, channelId, signal } = msg.payload || {};
  if (!targetPublicKey || !channelId || !signal) return;

  const channel = voiceChannels.get(channelId);
  if (!channel) return;

  const target = channel.get(targetPublicKey);
  if (!target || target.ws.readyState !== WebSocket.OPEN) return;

  // Forward the signal to the target peer
  target.ws.send(JSON.stringify({
    type: 'VOICE_SIGNAL_FORWARD',
    payload: { fromPublicKey: client.publicKey, channelId, signal },
    timestamp: Date.now(),
  }));
}

function handleIceCandidate(client: RelayClient, msg: any): void {
  const { targetPublicKey, channelId, candidate } = msg.payload || {};
  if (!targetPublicKey || !channelId || !candidate) return;

  const channel = voiceChannels.get(channelId);
  if (!channel) return;

  const target = channel.get(targetPublicKey);
  if (!target || target.ws.readyState !== WebSocket.OPEN) return;

  target.ws.send(JSON.stringify({
    type: 'VOICE_ICE_CANDIDATE_FORWARD',
    payload: { fromPublicKey: client.publicKey, channelId, candidate },
    timestamp: Date.now(),
  }));
}

function handleMute(client: RelayClient, msg: any, clients: Map<WebSocket, RelayClient>): void {
  const { channelId, muted } = msg.payload || {};
  if (!channelId || muted === undefined) return;

  const channel = voiceChannels.get(channelId);
  if (!channel) return;

  const participant = channel.get(client.publicKey);
  if (!participant) return;

  participant.muted = !!muted;

  // Broadcast mute update to all participants
  const payload = JSON.stringify({
    type: 'VOICE_MUTE_UPDATE',
    payload: { channelId, publicKey: client.publicKey, muted: !!muted },
    timestamp: Date.now(),
  });

  for (const [, p] of channel) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(payload);
  }
}

// =================================================================
// Helpers
// =================================================================

function removeFromChannel(client: RelayClient, channelId: string, clients: Map<WebSocket, RelayClient>): void {
  const channel = voiceChannels.get(channelId);
  if (!channel) return;

  channel.delete(client.publicKey);
  userChannel.delete(client.publicKey);

  console.log(`[voice] ${client.username} left voice channel ${channelId.slice(0, 12)} (${channel.size} remaining)`);

  // Clean up empty channels
  if (channel.size === 0) {
    voiceChannels.delete(channelId);
    return;
  }

  // Notify remaining participants
  const payload = JSON.stringify({
    type: 'VOICE_USER_LEFT',
    payload: { channelId, publicKey: client.publicKey },
    timestamp: Date.now(),
  });

  for (const [, p] of channel) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(payload);
  }

  broadcastVoiceState(channelId, clients);
}

function broadcastVoiceState(channelId: string, clients: Map<WebSocket, RelayClient>): void {
  const channel = voiceChannels.get(channelId);
  if (!channel) return;

  const participants = Array.from(channel.values()).map((p) => ({
    publicKey: p.publicKey,
    username: p.username,
    muted: p.muted,
  }));

  const payload = JSON.stringify({
    type: 'VOICE_STATE',
    payload: { channelId, participants },
    timestamp: Date.now(),
  });

  for (const [, p] of channel) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(payload);
  }
}

/** Get voice channel participant count (for stats). */
export function getVoiceStats(): { channels: number; participants: number } {
  let participants = 0;
  for (const ch of voiceChannels.values()) participants += ch.size;
  return { channels: voiceChannels.size, participants };
}
