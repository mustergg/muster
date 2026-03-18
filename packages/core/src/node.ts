/**
 * @muster/core — libp2p node factory
 *
 * Creates and returns a configured libp2p node instance.
 * This is the single entry point for all P2P networking in Muster.
 *
 * The node uses:
 *   - WebSockets transport (works in both browser and Node.js)
 *   - Noise Protocol for transport encryption
 *   - Yamux stream multiplexer
 *   - GossipSub for pub/sub messaging
 *   - Kademlia DHT for peer discovery
 *   - Bootstrap for initial network entry
 */

import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@libp2p/noise';
import { yamux } from '@libp2p/yamux';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { kadDHT } from '@libp2p/kad-dht';
import { bootstrap } from '@libp2p/bootstrap';
import { identify } from '@libp2p/identify';
import type { Libp2p } from 'libp2p';
import type { MusterNodeConfig } from './config.js';
import { DEFAULT_BOOTSTRAP_PEERS } from './config.js';

export type MusterNode = Libp2p;

/**
 * Create and start a Muster libp2p node.
 *
 * Call `await node.stop()` to shut down gracefully.
 *
 * @example
 * const node = await createMusterNode({ gossipD: 6 });
 * console.log('My peer ID:', node.peerId.toString());
 */
export async function createMusterNode(
  config: MusterNodeConfig = {},
): Promise<MusterNode> {
  const bootstrapList = config.bootstrapPeers ?? DEFAULT_BOOTSTRAP_PEERS;

  const node = await createLibp2p({
    // ── Addresses to listen on ────────────────────────────────────────────
    addresses: {
      listen: config.listenAddresses ?? [],
    },

    // ── Transports ────────────────────────────────────────────────────────
    transports: [
      webSockets(),
      // WebRTC will be added in Phase 3
    ],

    // ── Connection encryption ─────────────────────────────────────────────
    connectionEncryption: [
      noise(), // Noise Protocol XX handshake — mutual auth + encryption
    ],

    // ── Stream multiplexing ───────────────────────────────────────────────
    streamMuxers: [
      yamux(), // Yamux: efficient, well-supported multiplexer
    ],

    // ── Services ─────────────────────────────────────────────────────────
    services: {
      // Identify: exchange metadata (peer ID, listen addrs) with connected peers
      identify: identify(),

      // GossipSub: publish/subscribe messaging for channels
      pubsub: gossipsub({
        // Allow nodes that have not subscribed to a topic to receive messages
        // (needed for relay nodes that forward without subscribing themselves)
        allowPublishToUnsubscribedTopics: true,
        D:     config.gossipD     ?? 6,
        Dlow:  config.gossipDLow  ?? 4,
        Dhigh: config.gossipDHigh ?? 12,
      }),

      // Kademlia DHT: distributed peer and content discovery
      dht: kadDHT({
        // Run in client mode in browsers (no server-side DHT queries)
        clientMode: typeof window !== 'undefined',
      }),

      // Bootstrap: connect to well-known peers to enter the network
      ...(bootstrapList.length > 0
        ? {
            bootstrap: bootstrap({
              list: bootstrapList,
            }),
          }
        : {}),
    },
  });

  await node.start();
  return node;
}
