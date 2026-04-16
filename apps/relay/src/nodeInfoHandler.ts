/**
 * Node Info Handler — R20
 *
 * Responds to client requests for node information and peer lists.
 * Used by the client's nodeDiscovery system for connection fallback.
 */

import { NodeDB } from './nodeDB';
import type { RelayClient } from './types';

/** Process start time for uptime calculation. */
const processStartTime = Date.now();

/** First boot time — persisted in DB for active days calculation. */
let firstBootTime = 0;

export function initNodeInfo(nodeDB: NodeDB): void {
  const stored = nodeDB.getConfig('firstBootTime');
  if (stored) {
    firstBootTime = parseInt(stored);
  } else {
    firstBootTime = Date.now();
    nodeDB.setConfig('firstBootTime', String(firstBootTime));
  }
}

export function handleNodeInfoRequest(
  client: RelayClient,
  msg: any,
  nodeDB: NodeDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): void {
  switch (msg.type) {
    case 'GET_NODE_INFO': {
      const uptimeMs = Date.now() - processStartTime;
      const activeDays = Math.floor((Date.now() - firstBootTime) / 86400000);
      // Simple uptime % based on current session vs 24h
      const uptimePercent = Math.min(100, Math.round((uptimeMs / 86400000) * 100));

      sendToClient(client, {
        type: 'NODE_INFO',
        payload: {
          nodeId: nodeDB.getNodeId(),
          nodeName: nodeDB.getNodeName(),
          uptimePercent,
          activeDays,
          uptimeMs,
          version: nodeDB.getConfig('version') || '0.1.0',
        },
        timestamp: Date.now(),
      });
      break;
    }

    case 'GET_NODE_PEERS': {
      const peers = nodeDB.getAllPeers();
      const peerList = peers.map((p) => ({
        url: p.url,
        name: p.name || '',
        nodeId: p.nodeId,
        lastSeen: p.lastSeen,
        // Peers don't report uptime to us yet, set 0
        uptimePercent: 0,
        activeDays: 0,
      }));

      sendToClient(client, {
        type: 'NODE_PEERS',
        payload: { peers: peerList },
        timestamp: Date.now(),
      });
      break;
    }
  }
}
