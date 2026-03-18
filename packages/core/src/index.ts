/**
 * @muster/core — public API
 */

export type { MusterNode } from './node.js';
export { createMusterNode } from './node.js';

export type { MusterNodeConfig } from './config.js';
export {
  DEFAULT_BOOTSTRAP_PEERS,
  TOPIC_PREFIX,
  communityChannelTopic,
  communityPresenceTopic,
} from './config.js';

export type { MessageHandler } from './pubsub.js';
export { subscribe, publish, getTopicPeers } from './pubsub.js';
