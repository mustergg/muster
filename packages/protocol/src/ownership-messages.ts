/**
 * Ownership & Community Deletion Protocol Messages — R8
 *
 * ADD THIS FILE to packages/protocol/src/ and re-export from index.ts:
 *   export * from './ownership-messages.js';
 */

// =================================================================
// Client → Relay
// =================================================================

/** Request list of verified members eligible to receive ownership. */
export interface CheckTransferEligibilityMsg {
  type: 'CHECK_TRANSFER_ELIGIBILITY';
  payload: {
    communityId: string;
  };
  timestamp: number;
}

/** Transfer community ownership to another verified member. */
export interface TransferOwnershipMsg {
  type: 'TRANSFER_OWNERSHIP';
  payload: {
    communityId: string;
    newOwnerPublicKey: string;
  };
  timestamp: number;
}

/** Delete a community and all its data. Owner only. */
export interface DeleteCommunityMsg {
  type: 'DELETE_COMMUNITY_CMD';
  payload: {
    communityId: string;
    /** Must match the community name exactly (confirmation). */
    confirmName: string;
  };
  timestamp: number;
}

// =================================================================
// Relay → Client(s)
// =================================================================

/** List of eligible members for ownership transfer. */
export interface TransferEligibilityResponseMsg {
  type: 'TRANSFER_ELIGIBILITY';
  payload: {
    communityId: string;
    /** Verified members (excluding current owner). Empty = no eligible members. */
    eligibleMembers: Array<{
      publicKey: string;
      username: string;
      role: string;
    }>;
    /** Total member count (including owner). */
    totalMembers: number;
    /** Whether the owner is the sole member. */
    isOnlyMember: boolean;
  };
  timestamp: number;
}

/** Ownership was transferred. Sent to all community members. */
export interface OwnershipTransferredMsg {
  type: 'OWNERSHIP_TRANSFERRED';
  payload: {
    communityId: string;
    previousOwnerPublicKey: string;
    previousOwnerUsername: string;
    newOwnerPublicKey: string;
    newOwnerUsername: string;
  };
  timestamp: number;
}

/** Community was deleted. Sent to all community members. */
export interface CommunityDeletedMsg {
  type: 'COMMUNITY_DELETED';
  payload: {
    communityId: string;
    communityName: string;
    deletedBy: string;
  };
  timestamp: number;
}

/** Owner tried to leave without transferring. */
export interface OwnerCannotLeaveMsg {
  type: 'OWNER_CANNOT_LEAVE';
  payload: {
    communityId: string;
    reason: string;
    /** Hint: show transfer modal or delete option. */
    action: 'transfer' | 'delete_only';
  };
  timestamp: number;
}
export * from './ownership-messages.js';
