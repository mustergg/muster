/**
 * @muster/db — public API
 *
 * @example
 * import { MusterDB } from '@muster/db';
 *
 * // Browser (in-memory)
 * const db = await MusterDB.create();
 *
 * // Node.js (persistent)
 * const db = await MusterDB.create({ storagePath: '/data/muster' });
 */

export { MusterDB, type MusterDBConfig } from './MusterDB.js';

export type {
  StoredChatMessage,
  StoredCommunity,
  StoredCommunityMember,
  StoredChannel,
  StoredCategory,
  StoredUserProfile,
  PresenceEntry,
  PresenceStatus,
  ChannelType,
  ChannelVisibility,
  CommunityType,
  CommunityRole,
  StoreAddresses,
} from './types.js';

export type { MessageLogStore } from './stores/MessageLog.js';
export type { CommunityStore }  from './stores/CommunityStore.js';
export type { UserRegistry }    from './stores/UserRegistry.js';
