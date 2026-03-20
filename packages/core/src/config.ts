/**
 * @muster/core — node configuration
 *
 * All tuneable parameters for the libp2p node, GossipSub, and DHT.
 * Sensible defaults are provided — you only need to override what you need.
 */

/**
 * Bootstrap node multiaddresses.
 * These are the well-known entry points new peers use to join the network.
 * In production these will point to public Muster bootstrap infrastructure.
 * During development we use local addresses.
 */
export const DEFAULT_BOOTSTRAP_PEERS: string[] = [
  // These will be replaced with real bootstrap node addresses before launch.
  // Format: /dns4/<hostname>/tcp/<port>/wss/p2p/<peerID>
  '/ip4/192.168.1.73/tcp/4002/ws/p2p/12D3KooWDmzFgmPDKvKejPBHkX6ERKhHF83fWrVUHYe9WVDv3EhW',
];

/**
 * GossipSub topic prefix — all Muster topics start with this string.
 * This namespaces Muster traffic away from other GossipSub applications.
 */
export const TOPIC_PREFIX = '/muster/1.0.0';

/**
 * Build the GossipSub topic string for a community text channel.
 *
 * @example
 * communityChannelTopic('abc123', 'general-id')
 * // → '/muster/1.0.0/community/abc123/channel/general-id'
 */
export function communityChannelTopic(communityId: string, channelId: string): string {
  return `${TOPIC_PREFIX}/community/${communityId}/channel/${channelId}`;
}

/**
 * Build the GossipSub topic for community-wide presence events
 * (peer join/leave announcements).
 */
export function communityPresenceTopic(communityId: string): string {
  return `${TOPIC_PREFIX}/community/${communityId}/presence`;
}

/**
 * Configuration passed to `createMusterNode`.
 */
export interface MusterNodeConfig {
	peerId?: any;
  /**
   * Multiaddresses this node will listen on.
   *
   * Browser clients: leave empty — the browser WebRTC transport
   * picks addresses automatically.
   *
   * Desktop / server nodes:
   *   ['/ip4/0.0.0.0/tcp/0/ws']  — WebSocket on a random port
   *   ['/ip4/0.0.0.0/tcp/4002']  — raw TCP on port 4002
   */
  listenAddresses?: string[];

  /**
   * Bootstrap peer multiaddresses.
   * Defaults to DEFAULT_BOOTSTRAP_PEERS if not provided.
   */
  bootstrapPeers?: string[];

  /**
   * GossipSub D parameter — target number of full-message peers per topic.
   * Higher = faster propagation, more bandwidth.
   * Recommended: 6 (default), 4 for mobile, 8 for main nodes.
   */
  gossipD?: number;

  /**
   * GossipSub D_low — minimum peers before requesting more.
   * Must be less than gossipD. Default: 4.
   */
  gossipDLow?: number;

  /**
   * GossipSub D_high — maximum peers before pruning.
   * Must be greater than gossipD. Default: 12.
   */
  gossipDHigh?: number;
  
  extraServices?: Record<string, unknown>;
}
