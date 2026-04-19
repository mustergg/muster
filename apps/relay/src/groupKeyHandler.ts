/**
 * Group Key Handler — R22
 *
 * Processes group encryption messages from clients:
 *   GROUP_KEY_REQUEST    — member requests their encrypted keys for a channel
 *   GROUP_KEY_DISTRIBUTE — owner/admin distributes new/initial group key
 *   GROUP_KEY_ROTATE     — rotate key (after kick or manual)
 *   GROUP_CRYPTO_CONFIG  — set encryption settings for a channel
 */

import { WebSocket } from 'ws';
import { GroupKeyDB } from './groupKeyDB';
import { CommunityDB } from './communityDB';
import type { RelayClient } from './types';

export function handleGroupKeyMessage(
  client: RelayClient,
  msg: any,
  groupKeyDB: GroupKeyDB,
  communityDB: CommunityDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  switch (msg.type) {
    case 'GROUP_KEY_REQUEST':    handleKeyRequest(client, msg, groupKeyDB, communityDB, sendToClient); break;
    case 'GROUP_KEY_DISTRIBUTE': handleKeyDistribute(client, msg, groupKeyDB, communityDB, sendToClient); break;
    case 'GROUP_KEY_ROTATE':     handleKeyRotate(client, msg, groupKeyDB, communityDB, sendToClient, clients); break;
    case 'GROUP_CRYPTO_CONFIG':  handleCryptoConfig(client, msg, groupKeyDB, communityDB, sendToClient); break;
  }
}

function handleKeyRequest(
  client: RelayClient, msg: any,
  groupKeyDB: GroupKeyDB, communityDB: CommunityDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const { channelId } = msg.payload || {};
  if (!channelId) return;

  const config = groupKeyDB.getConfig(channelId);
  if (!config || !config.enabled) {
    sendToClient(client, {
      type: 'GROUP_KEY_RESPONSE',
      payload: {
        channelId,
        config: { channelId, enabled: false, historyAccess: 'all', currentEpoch: 0 },
        epochs: [],
      },
      timestamp: Date.now(),
    });
    return;
  }

  // Find when this member joined (for history filtering)
  const memberJoinedAt = findMemberJoinDate(client.publicKey, channelId, communityDB);

  // Get filtered bundles based on history access policy
  const bundles = groupKeyDB.getBundlesForUserFiltered(channelId, client.publicKey, config, memberJoinedAt);

  const epochs = bundles.map((b) => ({
    epoch: b.epoch,
    encryptedKey: b.encryptedKey,
    nonce: b.nonce,
    distributorPublicKey: b.distributorPublicKey,
    createdAt: b.createdAt,
  }));

  sendToClient(client, {
    type: 'GROUP_KEY_RESPONSE',
    payload: {
      channelId,
      config: {
        channelId: config.channelId,
        enabled: !!config.enabled,
        historyAccess: config.historyAccess,
        currentEpoch: config.currentEpoch,
      },
      epochs,
    },
    timestamp: Date.now(),
  });
}

function handleKeyDistribute(
  client: RelayClient, msg: any,
  groupKeyDB: GroupKeyDB, communityDB: CommunityDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const { channelId, epoch, bundles, distributorPublicKey } = msg.payload || {};
  if (!channelId || !bundles || !Array.isArray(bundles)) return;

  // Verify client is owner or admin of the community containing this channel
  if (!isChannelAdmin(client.publicKey, channelId, communityDB)) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'FORBIDDEN', message: 'Only owner/admin can distribute group keys' },
      timestamp: Date.now(),
    });
    return;
  }

  // Ensure config exists
  let config = groupKeyDB.getConfig(channelId);
  if (!config) {
    groupKeyDB.setConfig(channelId, true, 'from_join');
    config = groupKeyDB.getConfig(channelId)!;
  }

  // Determine epoch
  const newEpoch = epoch || groupKeyDB.incrementEpoch(channelId);
  const now = Date.now();

  // Store bundles
  const dbBundles = bundles.map((b: any) => ({
    channelId,
    epoch: newEpoch,
    recipientPublicKey: b.recipientPublicKey,
    encryptedKey: b.encryptedKey,
    nonce: b.nonce,
    distributorPublicKey: distributorPublicKey || client.publicKey,
    createdAt: now,
  }));

  groupKeyDB.storeBundles(dbBundles);

  console.log(`[group-key] ${client.username} distributed epoch ${newEpoch} for channel ${channelId.slice(0, 12)} to ${bundles.length} members`);

  sendToClient(client, {
    type: 'GROUP_KEY_DISTRIBUTED',
    payload: { channelId, epoch: newEpoch, recipientCount: bundles.length },
    timestamp: Date.now(),
  });
}

function handleKeyRotate(
  client: RelayClient, msg: any,
  groupKeyDB: GroupKeyDB, communityDB: CommunityDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
  allClients: Map<WebSocket, RelayClient>,
): void {
  const { channelId, reason, bundles, distributorPublicKey } = msg.payload || {};
  if (!channelId || !bundles || !Array.isArray(bundles)) return;

  if (!isChannelAdmin(client.publicKey, channelId, communityDB)) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'FORBIDDEN', message: 'Only owner/admin can rotate group keys' },
      timestamp: Date.now(),
    });
    return;
  }

  const newEpoch = groupKeyDB.incrementEpoch(channelId);
  const now = Date.now();

  // Store new bundles
  const dbBundles = bundles.map((b: any) => ({
    channelId,
    epoch: newEpoch,
    recipientPublicKey: b.recipientPublicKey,
    encryptedKey: b.encryptedKey,
    nonce: b.nonce,
    distributorPublicKey: distributorPublicKey || client.publicKey,
    createdAt: now,
  }));

  groupKeyDB.storeBundles(dbBundles);

  console.log(`[group-key] Key rotated for channel ${channelId.slice(0, 12)}: epoch ${newEpoch}, reason: ${reason}, ${bundles.length} members`);

  // Notify all online members that key was rotated
  const recipientKeys = new Set(bundles.map((b: any) => b.recipientPublicKey));
  for (const [ws, c] of allClients) {
    if (c.authenticated && recipientKeys.has(c.publicKey) && ws.readyState === WebSocket.OPEN) {
      const bundle = bundles.find((b: any) => b.recipientPublicKey === c.publicKey);
      if (bundle) {
        ws.send(JSON.stringify({
          type: 'GROUP_KEY_ROTATED',
          payload: {
            channelId,
            epoch: newEpoch,
            encryptedKey: bundle.encryptedKey,
            nonce: bundle.nonce,
            distributorPublicKey: distributorPublicKey || client.publicKey,
            reason: reason || 'manual',
          },
          timestamp: now,
        }));
      }
    }
  }

  sendToClient(client, {
    type: 'GROUP_KEY_DISTRIBUTED',
    payload: { channelId, epoch: newEpoch, recipientCount: bundles.length, rotated: true },
    timestamp: Date.now(),
  });
}

function handleCryptoConfig(
  client: RelayClient, msg: any,
  groupKeyDB: GroupKeyDB, communityDB: CommunityDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const { channelId, communityId, enabled, historyAccess, historyFromDate } = msg.payload || {};
  if (!channelId) return;

  if (!isChannelAdmin(client.publicKey, channelId, communityDB)) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'FORBIDDEN', message: 'Only owner/admin can configure channel encryption' },
      timestamp: Date.now(),
    });
    return;
  }

  groupKeyDB.setConfig(channelId, !!enabled, historyAccess || 'from_join', historyFromDate);

  console.log(`[group-key] Config updated for channel ${channelId.slice(0, 12)}: enabled=${enabled}, history=${historyAccess}`);

  sendToClient(client, {
    type: 'GROUP_CRYPTO_CONFIG_OK',
    payload: { channelId, enabled: !!enabled, historyAccess: historyAccess || 'from_join' },
    timestamp: Date.now(),
  });
}

// =================================================================
// Helpers
// =================================================================

function isChannelAdmin(publicKey: string, channelId: string, communityDB: CommunityDB): boolean {
  // Find which community this channel belongs to
  const allCommunities = communityDB.getAllCommunityIds();
  for (const cid of allCommunities) {
    const channels = communityDB.getChannels(cid);
    if (channels.some((ch) => ch.id === channelId)) {
      const community = communityDB.getCommunity(cid);
      if (!community) return false;
      // Owner always has permission
      if (community.ownerPublicKey === publicKey) return true;
      // Check for admin role
      const members = communityDB.getMembers(cid);
      const member = members.find((m) => m.publicKey === publicKey);
      return member?.role === 'admin' || member?.role === 'owner';
    }
  }
  return false;
}

function findMemberJoinDate(publicKey: string, channelId: string, communityDB: CommunityDB): number {
  const allCommunities = communityDB.getAllCommunityIds();
  for (const cid of allCommunities) {
    const channels = communityDB.getChannels(cid);
    if (channels.some((ch) => ch.id === channelId)) {
      const members = communityDB.getMembers(cid);
      const member = members.find((m) => m.publicKey === publicKey);
      return member?.joinedAt || 0;
    }
  }
  return 0;
}
