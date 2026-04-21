/**
 * WebSocket Relay Proxy — R24
 *
 * Enables Main Nodes to act as transparent proxies for Client Nodes
 * that are behind NAT and can't accept inbound connections.
 *
 * Flow:
 *   1. Client Node behind NAT connects outbound to Main Node
 *   2. Client Node registers as a "proxied node" with its communities
 *   3. When a browser client requests data from a proxied community,
 *      the Main Node forwards the request through the existing outbound connection
 *   4. All forwarded data is E2E encrypted — Main Node is a blind proxy
 *
 * This works alongside PeerManager (R15) which handles node-to-node sync.
 * The proxy adds: client-to-node routing through the Main Node.
 */

import { WebSocket } from 'ws';
import { createConnection } from 'net';
import type { RelayClient } from './types';

// =================================================================
// Types
// =================================================================

interface ProxiedNode {
  /** The WebSocket connection from the proxied node to us (outbound from their side). */
  ws: WebSocket;
  /** Node ID of the proxied node. */
  nodeId: string;
  /** Communities hosted by the proxied node. */
  communityIds: string[];
  /** Node name. */
  name: string;
  /** When the node connected. */
  connectedAt: number;
}

// =================================================================
// State
// =================================================================

/** Map of nodeId → proxied node connection. */
const proxiedNodes = new Map<string, ProxiedNode>();

/** Map of communityId → nodeIds that host it (for routing). */
const communityRoutes = new Map<string, Set<string>>();

// =================================================================
// Registration
// =================================================================

/** Register a node as proxied (called when a Client Node connects outbound). */
export function registerProxiedNode(ws: WebSocket, nodeId: string, name: string, communityIds: string[]): void {
  const existing = proxiedNodes.get(nodeId);
  if (existing && existing.ws !== ws) {
    // Close old connection
    try { existing.ws.close(); } catch { /* */ }
  }

  proxiedNodes.set(nodeId, {
    ws,
    nodeId,
    communityIds,
    name,
    connectedAt: Date.now(),
  });

  // Update community routes
  for (const cid of communityIds) {
    if (!communityRoutes.has(cid)) communityRoutes.set(cid, new Set());
    communityRoutes.get(cid)!.add(nodeId);
  }

  console.log(`[proxy] Registered proxied node: ${name || nodeId.slice(0, 12)} (${communityIds.length} communities)`);

  // Cleanup on disconnect
  ws.on('close', () => {
    unregisterProxiedNode(nodeId);
  });
}

/** Unregister a proxied node. */
export function unregisterProxiedNode(nodeId: string): void {
  const node = proxiedNodes.get(nodeId);
  if (!node) return;

  // Remove from community routes
  for (const cid of node.communityIds) {
    communityRoutes.get(cid)?.delete(nodeId);
    if (communityRoutes.get(cid)?.size === 0) communityRoutes.delete(cid);
  }

  proxiedNodes.delete(nodeId);
  console.log(`[proxy] Unregistered proxied node: ${node.name || nodeId.slice(0, 12)}`);
}

// =================================================================
// Message forwarding
// =================================================================

/** Forward a message from a client to a proxied node (if the community is hosted there). */
export function forwardToProxiedNode(communityId: string, msg: any): boolean {
  const nodeIds = communityRoutes.get(communityId);
  if (!nodeIds || nodeIds.size === 0) return false;

  const payload = JSON.stringify({
    type: 'PROXY_FORWARD',
    payload: { originalMessage: msg, communityId },
    timestamp: Date.now(),
  });

  let forwarded = false;
  for (const nodeId of nodeIds) {
    const node = proxiedNodes.get(nodeId);
    if (node && node.ws.readyState === WebSocket.OPEN) {
      node.ws.send(payload);
      forwarded = true;
      break; // Forward to first available node
    }
  }

  return forwarded;
}

/** Forward a response from a proxied node back to the requesting client. */
export function forwardToClient(
  client: RelayClient,
  msg: any,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  sendToClient(client, msg);
}

// =================================================================
// Port check handler
// =================================================================

/** Port probe timeout (ms). */
const PORT_PROBE_TIMEOUT_MS = 5000;

/** Normalize a remoteAddress (strips IPv4-mapped IPv6 prefix `::ffff:`). */
function normalizeRemoteAddress(addr: string | undefined): string {
  if (!addr) return '';
  return addr.startsWith('::ffff:') ? addr.slice(7) : addr;
}

/** TCP-connect probe: resolves to true if the port accepts a connection within the timeout. */
function probePort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* */ }
      resolve(ok);
    };

    const socket = createConnection({ host, port, timeout: timeoutMs });
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * Handle PORT_CHECK_REQUEST from a client — probe the port from this relay.
 *
 * Target host is the client's remote IP (what the relay sees), optionally
 * overridden by `payload.host` so clients with a public DNS name can check
 * that specific name. This is a legitimate external probe whenever the relay
 * is reached over the public internet; it degenerates to a LAN probe only
 * when the relay and client share a network.
 */
export function handlePortCheck(
  client: RelayClient,
  msg: any,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
): void {
  const { port, host: hostOverride } = msg.payload || {};
  if (!port || typeof port !== 'number') return;

  const remoteIp = normalizeRemoteAddress((client.ws as any)._socket?.remoteAddress);
  const host = (typeof hostOverride === 'string' && hostOverride.trim()) || remoteIp;

  if (!host) {
    sendToClient(client, {
      type: 'PORT_CHECK_RESULT',
      payload: { port, reachable: null, note: 'Relay could not determine client address' },
      timestamp: Date.now(),
    });
    return;
  }

  probePort(host, port, PORT_PROBE_TIMEOUT_MS).then((reachable) => {
    sendToClient(client, {
      type: 'PORT_CHECK_RESULT',
      payload: { port, reachable, probedHost: host, timeoutMs: PORT_PROBE_TIMEOUT_MS },
      timestamp: Date.now(),
    });
  });
}

// =================================================================
// Stats
// =================================================================

export function getProxyStats(): { proxiedNodes: number; routedCommunities: number } {
  return {
    proxiedNodes: proxiedNodes.size,
    routedCommunities: communityRoutes.size,
  };
}

/** Get list of proxied nodes for admin/debug. */
export function getProxiedNodeList(): Array<{ nodeId: string; name: string; communityCount: number; connectedAt: number }> {
  return Array.from(proxiedNodes.values()).map((n) => ({
    nodeId: n.nodeId,
    name: n.name,
    communityCount: n.communityIds.length,
    connectedAt: n.connectedAt,
  }));
}
