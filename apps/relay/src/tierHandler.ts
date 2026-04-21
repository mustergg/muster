/**
 * Tier Handler — R21
 *
 * Handles client requests related to the node tier system:
 *   GET_STORAGE_STATS  — return storage stats and tier info
 *   STORAGE_PREFERENCE — client sets their retention preferences (logged only)
 *   CLEAR_CACHE        — client requests cache cleanup
 */

import type { RelayClient } from './types';
import { TierManager } from './nodeTier';
import { RelayDB } from './database';
import { CommunityDB } from './communityDB';
import { DMDB } from './dmDB';

export function handleTierMessage(
  client: RelayClient,
  msg: any,
  tierManager: TierManager,
  messageDB: RelayDB,
  communityDB: CommunityDB,
  dmDB: DMDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): void {
  switch (msg.type) {
    case 'GET_STORAGE_STATS': {
      const stats = tierManager.getStorageStats(messageDB, dmDB, communityDB);
      sendToClient(client, {
        type: 'STORAGE_STATS',
        payload: stats,
        timestamp: Date.now(),
      });
      break;
    }

    case 'STORAGE_PREFERENCE': {
      // Log user preference — useful for analytics but retention is node-side
      const { mode, purgeDays } = msg.payload || {};
      console.log(`[tier] User ${client.username} set retention: ${mode} (${purgeDays}d)`);
      break;
    }

    case 'CLEAR_CACHE': {
      const { targetId, all } = msg.payload || {};
      let purged = 0;
      let skipped: string | null = null;

      if (all) {
        console.log(`[tier] User ${client.username} requested full cache clear`);
        purged = tierManager.purgeAllNonHosted(messageDB, communityDB);
      } else if (typeof targetId === 'string' && targetId) {
        console.log(`[tier] User ${client.username} requested cache clear for: ${targetId.slice(0, 12)}`);
        const result = tierManager.purgeCommunity(targetId, messageDB, communityDB);
        if (result < 0) {
          skipped = 'hosted';
        } else {
          purged = result;
        }
      }

      sendToClient(client, {
        type: 'CACHE_CLEARED',
        payload: { targetId: targetId || 'all', success: skipped === null, purged, skipped },
        timestamp: Date.now(),
      });
      break;
    }
  }
}
