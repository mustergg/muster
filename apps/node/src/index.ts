// @ts-nocheck
import { createMusterNode } from '@muster/core';
import { circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { createEd25519PeerId } from '@libp2p/peer-id-factory';
import { exportToProtobuf, createFromProtobuf } from '@libp2p/peer-id-factory';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';

const LISTEN_WS_PORT  = parseInt(process.env['MUSTER_WS_PORT']  ?? '4002', 10);
const LISTEN_TCP_PORT = parseInt(process.env['MUSTER_TCP_PORT'] ?? '4003', 10);
const DATA_DIR        = process.env['MUSTER_DATA_DIR'] ?? join(homedir(), '.muster-node');
const PEER_ID_FILE    = join(DATA_DIR, 'peer-id.bin');

async function loadOrCreatePeerId() {
  if (existsSync(PEER_ID_FILE)) {
    console.log('[muster-node] Loading existing Peer ID...');
    const data = readFileSync(PEER_ID_FILE);
    return createFromProtobuf(data);
  }
  console.log('[muster-node] Generating new Peer ID...');
  const peerId = await createEd25519PeerId();
  writeFileSync(PEER_ID_FILE, exportToProtobuf(peerId));
  return peerId;
}

async function main(): Promise<void> {
  console.log('[muster-node] Starting bootstrap node...');
  mkdirSync(DATA_DIR, { recursive: true });

  const peerId = await loadOrCreatePeerId();
  console.log('[muster-node] Peer ID:', peerId.toString());

  const node = await createMusterNode({
    peerId,
    listenAddresses: [
      `/ip4/0.0.0.0/tcp/${LISTEN_WS_PORT}/ws`,
      `/ip4/0.0.0.0/tcp/${LISTEN_TCP_PORT}`,
    ],
    bootstrapPeers: [],
    gossipD: 1, gossipDLow: 0, gossipDHigh: 4,
    extraServices: {
      relay: circuitRelayServer(),
    },
  });

  console.log('[muster-node] Node started.');
  console.log('[muster-node] Listening on:');
  node.getMultiaddrs().forEach((ma) => console.log('  ', ma.toString()));

  node.addEventListener('peer:connect',    (e) => console.log('[muster-node] + Peer:', e.detail.toString(), '| total:', node.getPeers().length));
  node.addEventListener('peer:disconnect', (e) => console.log('[muster-node] - Peer:', e.detail.toString(), '| total:', node.getPeers().length));

  const shutdown = async () => {
    console.log('\n[muster-node] Shutting down...');
    await node.stop();
    process.exit(0);
  };
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  console.log('[muster-node] Ready. Press Ctrl+C to stop.');
}

main().catch((err) => { console.error('[muster-node] Fatal error:', err); process.exit(1); });
