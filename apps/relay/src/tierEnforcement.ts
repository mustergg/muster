/**
 * Tier Enforcement — checks user tier before allowing restricted actions.
 *
 * Returns null if the action is allowed, or a restriction message if blocked.
 *
 * Basic user restrictions:
 * - Cannot join communities (only by invite — handled in communityHandler)
 * - Cannot initiate DMs (can only receive/reply)
 * - Cannot create/delete communities
 * - Cannot delete conversations
 * - Can only edit messages within 5 minutes
 * - Cannot be the sole moderator of a community
 */

import { UserDB } from './userDB';
import type { RelayClient } from './types';

export interface TierCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if an action is allowed for the given client's tier.
 * Returns { allowed: true } or { allowed: false, reason: '...' }.
 */
export function checkTier(
  client: RelayClient,
  action: string,
  userDB: UserDB,
  context?: Record<string, any>,
): TierCheckResult {
  const tier = userDB.getTier(client.publicKey);

  // Verified users have no restrictions
  if (tier === 'verified') return { allowed: true };

  // Basic user restrictions
  switch (action) {
    case 'CREATE_COMMUNITY':
      return {
        allowed: false,
        reason: 'Basic accounts cannot create communities. Verify your email to unlock this feature.',
      };

    case 'JOIN_COMMUNITY':
      // Basic users can only join by invite (the invite flag must be set)
      if (!context?.byInvite) {
        return {
          allowed: false,
          reason: 'Basic accounts can only join communities via invite link. Verify your email to join freely.',
        };
      }
      return { allowed: true };

    case 'SEND_DM':
      // Basic users cannot initiate DMs — check if there's an existing conversation
      if (!context?.hasExistingConversation) {
        return {
          allowed: false,
          reason: 'Basic accounts cannot start new DM conversations. Verify your email to unlock DMs. Other users can still message you.',
        };
      }
      // Can reply to existing conversations
      return { allowed: true };

    case 'DELETE_CONVERSATION':
      return {
        allowed: false,
        reason: 'Basic accounts cannot delete conversations. Verify your email to unlock this feature.',
      };

    case 'DELETE_OWN_MESSAGE':
      // Basic users can only edit/delete within 5 minutes
      if (context?.messageAge && context.messageAge > 5 * 60 * 1000) {
        return {
          allowed: false,
          reason: 'Basic accounts can only edit or delete messages within 5 minutes of sending.',
        };
      }
      return { allowed: true };

    case 'LEAVE_COMMUNITY':
      // Always allowed — even basic users can leave
      return { allowed: true };

    default:
      // All other actions are allowed for basic users
      return { allowed: true };
  }
}

/**
 * Convenience: send a TIER_RESTRICTED message to the client if action is blocked.
 * Returns true if the action was blocked (caller should stop processing).
 */
export function enforceTier(
  client: RelayClient,
  action: string,
  userDB: UserDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  context?: Record<string, any>,
): boolean {
  const result = checkTier(client, action, userDB, context);

  if (!result.allowed) {
    const tier = userDB.getTier(client.publicKey);
    sendToClient(client, {
      type: 'TIER_RESTRICTED',
      payload: {
        action,
        reason: result.reason || 'This action requires a verified account.',
        requiredTier: 'verified',
        currentTier: tier,
      },
      timestamp: Date.now(),
    });
    console.log(`[relay] Tier blocked: ${client.username} (${tier}) tried ${action}`);
    return true; // blocked
  }

  return false; // allowed
}
