/**
 * Muster main node — daemon entry point (Phase 1)
 *
 * Starts a libp2p node on TCP + WebSocket transports so browser clients
 * and other nodes can connect to it.
 *
 * Phase 1: basic relay/bootstrap node that lets two browser clients
 * discover each other and exchange messages.
 *
 * Usage:  node dist/index.js
 * Or:     muster-node start   (after `pnpm build`)
 */

import { createMusterNode } from '@muster/core';
import { subscribe, communityChannelTopic } from '@muster/core';

const LISTEN_WS_PORT  = parseInt(process.env['MUSTER_WS_PORT']  ?? '4002', 10);
const LISTEN_TCP_PORT = parseInt(process.env['MUSTER_TCP_PORT'] ?? '4003', 10);

async function main(): Promise<void> {
  console.log('[muster-node] Starting node daemon…');

  const node = await createMusterNode({
    listenAddresses: [
      `/ip4/0.0.0.0/tcp/${LISTEN_WS_PORT}/ws`,
      `/ip4/0.0.0.0/tcp/${LISTEN_TCP_PORT}`,
    ],
    gossipD:     8,   // Main nodes use higher fanout for better propagation
    gossipDLow:  6,
    gossipDHigh: 16,
  });

  console.log('[muster-node] Node started.');
  console.log('[muster-node] Peer ID:', node.peerId.toString());
  console.log('[muster-node] Listening on:');
  node.getMultiaddrs().forEach((ma) => {
    console.log('  ', ma.toString());
  });

  // Track connected peers
  node.addEventListener('peer:connect', (event) => {
    console.log('[muster-node] Peer connected:   ', event.detail.toString());
  });
  node.addEventListener('peer:disconnect', (event) => {
    console.log('[muster-node] Peer disconnected:', event.detail.toString());
  });

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log('\n[muster-node] Shutting down…');
    await node.stop();
    process.exit(0);
  };
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  console.log('[muster-node] Ready. Press Ctrl+C to stop.');
}

main().catch((err: unknown) => {
  console.error('[muster-node] Fatal error:', err);
  process.exit(1);
});
