// @ts-nocheck
import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@libp2p/noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { kadDHT } from '@libp2p/kad-dht';
import { bootstrap } from '@libp2p/bootstrap';
import { identify } from '@libp2p/identify';
import { ping } from '@libp2p/ping';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { multiaddr } from '@multiformats/multiaddr';
import type { MusterNodeConfig } from './config.js';
import { DEFAULT_BOOTSTRAP_PEERS } from './config.js';

export type MusterNode = Awaited<ReturnType<typeof createLibp2p>>;

export async function createMusterNode(
  config: MusterNodeConfig = {},
): Promise<MusterNode> {
  const bootstrapList = config.bootstrapPeers ?? DEFAULT_BOOTSTRAP_PEERS;

  console.log('[Core] Bootstrap list:', bootstrapList);
  console.log('[Core] Creating libp2p node...');

  const services: Record<string, unknown> = {
    identify: identify(),
    ping:     ping(),
    pubsub:   gossipsub({
      allowPublishToUnsubscribedTopics: true,
      D:     config.gossipD     ?? 1,
      Dlow:  config.gossipDLow  ?? 0,
      Dhigh: config.gossipDHigh ?? 4,
    }),
    dht: kadDHT({ clientMode: typeof window !== 'undefined' }),
  };

  if (bootstrapList.length > 0) {
    services['bootstrap'] = bootstrap({ list: bootstrapList });
  }

  if (config.extraServices) {
    Object.assign(services, config.extraServices);
  }

  const node = await createLibp2p({
	peerId: config.peerId,
    addresses: { listen: config.listenAddresses ?? [] },
    connectionGater: { denyDialMultiaddr: () => false },
    transports: [
      webSockets({ filter: () => true }),
      circuitRelayTransport(),
    ],
    connectionEncrypters: [noise()],
    streamMuxers:         [yamux()],
    services,
  });

  await node.start();

  console.log('[Core] Node started, peer ID:', node.peerId.toString());
  console.log('[Core] Multiaddrs:', node.getMultiaddrs().map((m) => m.toString()));

  if (bootstrapList.length > 0) {
    console.log('[Core] Dialling bootstrap peers...');
    setTimeout(async () => {
      for (const addr of bootstrapList) {
        try {
          await node.dial(multiaddr(addr));
          console.log('[Core] Connected to bootstrap:', addr);
        } catch (err: unknown) {
          console.warn('[Core] Failed to dial bootstrap:', addr, String(err));
        }
      }
    }, 1000);
  }

  return node;
}