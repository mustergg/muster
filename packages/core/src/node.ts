// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@libp2p/noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { kadDHT } from '@libp2p/kad-dht';
import { bootstrap } from '@libp2p/bootstrap';
import { identify } from '@libp2p/identify';
import { ping } from '@libp2p/ping';
import type { MusterNodeConfig } from './config.js';
import { DEFAULT_BOOTSTRAP_PEERS } from './config.js';
import { multiaddr } from '@multiformats/multiaddr';

export type MusterNode = Awaited<ReturnType<typeof createLibp2p>>;

export async function createMusterNode(
  config: MusterNodeConfig = {},
): Promise<MusterNode> {
  const bootstrapList = config.bootstrapPeers ?? DEFAULT_BOOTSTRAP_PEERS;

console.log('[Core] Bootstrap list:', bootstrapList);
console.log('[Core] Creating libp2p node...');

  const node = await createLibp2p({
  addresses: {
    listen: config.listenAddresses ?? [],
  },
  connectionGater: {
    denyDialMultiaddr: () => false, // permite ligar a qualquer endereço
  },
  transports: [
    webSockets({
      filter: () => true,
    }),
  ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
	  ping: ping(),
      pubsub: gossipsub({
        allowPublishToUnsubscribedTopics: true,
        D:     config.gossipD     ?? 6,
        Dlow:  config.gossipDLow  ?? 4,
        Dhigh: config.gossipDHigh ?? 12,
      }),
      dht: kadDHT({ clientMode: true }),
      ...(bootstrapList.length > 0
        ? { bootstrap: bootstrap({ list: bootstrapList }) }
        : {}),
    },
  });

  await node.start();
  
  console.log('[Core] Node started, peer ID:', node.peerId.toString());
  console.log('[Core] Multiaddrs:', node.getMultiaddrs().map(m => m.toString()));

// Force dial bootstrap peers using libp2p's internal multiaddr
if (bootstrapList.length > 0) {
  console.log('[Core] Dialling bootstrap peers...');
  setTimeout(async () => {
    for (const addr of bootstrapList) {
      try {
        const { multiaddr: ma } = await import('@multiformats/multiaddr');
        const maddr = ma(addr);
        await node.dial(maddr);
        console.log('[Core] Connected to bootstrap:', addr);
      } catch (err: unknown) {
        console.warn('[Core] Failed to dial bootstrap:', addr, String(err));
      }
    }
  }, 1000);
}

  return node;
}