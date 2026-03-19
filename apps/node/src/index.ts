// @ts-nocheck
/**
 * Muster bootstrap node — lightweight P2P relay (no OrbitDB)
 * OrbitDB/Helia removed — requires native modules incompatible with ARM.
 * The bootstrap node only needs libp2p WebSocket + TCP + GossipSub.
 */

import { createMusterNode } from '@muster/core';

const LISTEN_WS_PORT  = parseInt(process.env['MUSTER_WS_PORT']  ?? '4002', 10);
const LISTEN_TCP_PORT = parseInt(process.env['MUSTER_TCP_PORT'] ?? '4003', 10);

async function main(): Promise<void> {
  console.log('[muster-node] Starting bootstrap node...');

  const node = await createMusterNode({
    listenAddresses: [
      `/ip4/0.0.0.0/tcp/${LISTEN_WS_PORT}/ws`,
      `/ip4/0.0.0.0/tcp/${LISTEN_TCP_PORT}`,
    ],
    gossipD: 8, gossipDLow: 6, gossipDHigh: 16,
  });

  console.log('[muster-node] Node started.');
  console.log('[muster-node] Peer ID:', node.peerId.toString());
  console.log('[muster-node] Listening on:');
  node.getMultiaddrs().forEach((ma) => console.log('  ', ma.toString()));

  node.addEventListener('peer:connect',    (e) => console.log('[muster-node] + Peer:', e.detail.toString(), '| total:', node.getPeers().length));
  node.addEventListener('peer:disconnect', (e) => console.log('[muster-node] - Peer:', e.detail.toString(), '| total:', node.getPeers().length));

  const shutdown = async (): Promise<void> => {
    console.log('\n[muster-node] Shutting down...');
    await node.stop();
    process.exit(0);
  };
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  console.log('[muster-node] Ready. Press Ctrl+C to stop.');
}

main().catch((err) => { console.error('[muster-node] Fatal error:', err); process.exit(1); });