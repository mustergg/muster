// @ts-nocheck
/**
 * Muster main node — daemon entry point (Phase 2)
 *
 * Now includes OrbitDB for persistent storage of community data.
 */

import { createMusterNode } from '@muster/core';
import { MusterDB } from '@muster/db';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

const LISTEN_WS_PORT  = parseInt(process.env['MUSTER_WS_PORT']  ?? '4002', 10);
const LISTEN_TCP_PORT = parseInt(process.env['MUSTER_TCP_PORT'] ?? '4003', 10);
const DATA_DIR        = process.env['MUSTER_DATA_DIR'] ?? join(homedir(), '.muster-node');

async function main(): Promise<void> {
  console.log('[muster-node] Starting node daemon...');

  mkdirSync(DATA_DIR, { recursive: true });
  console.log(`[muster-node] Data directory: ${DATA_DIR}`);

  const node = await createMusterNode({
    listenAddresses: [
      `/ip4/0.0.0.0/tcp/${LISTEN_WS_PORT}/ws`,
      `/ip4/0.0.0.0/tcp/${LISTEN_TCP_PORT}`,
    ],
    gossipD: 8, gossipDLow: 6, gossipDHigh: 16,
  });

  console.log('[muster-node] P2P node started.');
  console.log('[muster-node] Peer ID:', node.peerId.toString());
  console.log('[muster-node] Listening on:');
  node.getMultiaddrs().forEach((ma) => console.log('  ', ma.toString()));

  console.log('[muster-node] Starting OrbitDB...');
  const db = await MusterDB.create({
    storagePath: join(DATA_DIR, 'orbitdb'),
    libp2p: node,
  });

  const registry = await db.getUserRegistry();
  console.log('[muster-node] User registry:', registry.address);
  console.log('[muster-node] OrbitDB ready.');

  node.addEventListener('peer:connect',    (e) => console.log('[muster-node] Peer connected:   ', e.detail.toString()));
  node.addEventListener('peer:disconnect', (e) => console.log('[muster-node] Peer disconnected:', e.detail.toString()));

  const shutdown = async (): Promise<void> => {
    console.log('\n[muster-node] Shutting down...');
    await db.close();
    await node.stop();
    process.exit(0);
  };
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  console.log('[muster-node] Ready. Press Ctrl+C to stop.');
}

main().catch((err) => { console.error('[muster-node] Fatal error:', err); process.exit(1); });
