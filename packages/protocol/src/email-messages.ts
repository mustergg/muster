/**
 * Email Verification & Account Tier Protocol — R6
 *
 * ADD to packages/protocol/src/ and re-export from index.ts:
 *   export * from './email-messages';
 */

// =================================================================
// User tiers
// =================================================================

export type UserTier = 'basic' | 'verified';

export interface UserAccountInfo {
  publicKey: string;
  username: string;
  tier: UserTier;
  emailVerified: boolean;
  createdAt: number;
  /** Days remaining before auto-deletion (basic users only). 0 = verified. */
  daysRemaining: number;
}

// =================================================================
// Messages: Client → Relay
// =================================================================

/** Register an email for verification. */
export interface RegisterEmailMsg {
  type: 'REGISTER_EMAIL';
  payload: {
    /** The email address (sent in plaintext to relay for sending verification, stored as SHA-256 hash). */
    email: string;
  };
  timestamp: number;
}

/** Submit the verification code received by email. */
export interface VerifyEmailMsg {
  type: 'VERIFY_EMAIL';
  payload: {
    code: string;
  };
  timestamp: number;
}

/** Request to resend the verification code. */
export interface ResendVerificationMsg {
  type: 'RESEND_VERIFICATION';
  payload: {};
  timestamp: number;
}

/** Request current account info (tier, days remaining, etc). */
export interface AccountInfoRequestMsg {
  type: 'ACCOUNT_INFO_REQUEST';
  payload: {};
  timestamp: number;
}

// =================================================================
// Messages: Relay → Client
// =================================================================

/** Account info response — sent after auth and on request. */
export interface AccountInfoMsg {
  type: 'ACCOUNT_INFO';
  payload: UserAccountInfo;
  timestamp: number;
}

/** Email registration result. */
export interface EmailRegisteredMsg {
  type: 'EMAIL_REGISTERED';
  payload: {
    success: boolean;
    message: string;
  };
  timestamp: number;
}

/** Email verification result. */
export interface EmailVerifiedMsg {
  type: 'EMAIL_VERIFIED';
  payload: {
    success: boolean;
    tier: UserTier;
    message: string;
  };
  timestamp: number;
}

/** Action denied due to tier restriction. */
export interface TierRestrictedMsg {
  type: 'TIER_RESTRICTED';
  payload: {
    action: string;
    reason: string;
    requiredTier: UserTier;
    currentTier: UserTier;
  };
  timestamp: number;
}
