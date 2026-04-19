/**
 * Group Crypto Protocol — R22
 *
 * Message types for group E2E encryption in communities and squads.
 * The relay stores encrypted key bundles but never sees plaintext keys.
 *
 * Key distribution uses ECDH: the key distributor encrypts the group key
 * with each recipient's public key (Ed25519→X25519 conversion from R14).
 *
 * ADD to packages/protocol/src/ and re-export from index.ts:
 *   export * from './group-crypto-messages.js';
 */

// =================================================================
// Types
// =================================================================

/** How much history new members can access. */
export type HistoryAccess = 'all' | 'from_join' | 'from_date' | 'pinned_only';

/** A single key epoch — one generation of the group key. */
export interface KeyEpoch {
  epoch: number;
  /** Encrypted group key (hex), encrypted for a specific recipient via ECDH. */
  encryptedKey: string;
  /** Nonce used for encryption (hex). */
  nonce: string;
  /** Public key of the key distributor (for ECDH derivation). */
  distributorPublicKey: string;
  /** Timestamp when this epoch started. */
  createdAt: number;
}

/** Channel encryption config (set by owner/admin). */
export interface ChannelCryptoConfig {
  channelId: string;
  /** Whether E2E is enabled for this channel. */
  enabled: boolean;
  /** History access policy for new members. */
  historyAccess: HistoryAccess;
  /** If historyAccess is 'from_date', the cutoff timestamp. */
  historyFromDate?: number;
  /** Current epoch number. */
  currentEpoch: number;
}

// =================================================================
// Client → Relay
// =================================================================

/** Request group keys for a channel. Relay returns encrypted keys for this user. */
export interface GroupKeyRequestMsg {
  type: 'GROUP_KEY_REQUEST';
  payload: {
    channelId: string;
  };
  timestamp: number;
}

/** Owner/admin distributes a new group key (or rotated key) to all members. */
export interface GroupKeyDistributeMsg {
  type: 'GROUP_KEY_DISTRIBUTE';
  payload: {
    channelId: string;
    epoch: number;
    /** Array of encrypted keys, one per member. */
    bundles: Array<{
      recipientPublicKey: string;
      encryptedKey: string;
      nonce: string;
    }>;
    /** Public key of distributor (for ECDH). */
    distributorPublicKey: string;
  };
  timestamp: number;
}

/** Set encryption config for a channel (owner/admin only). */
export interface GroupCryptoConfigMsg {
  type: 'GROUP_CRYPTO_CONFIG';
  payload: {
    channelId: string;
    communityId: string;
    enabled: boolean;
    historyAccess: HistoryAccess;
    historyFromDate?: number;
  };
  timestamp: number;
}

/** Request to rotate the group key (e.g., after kick). */
export interface GroupKeyRotateMsg {
  type: 'GROUP_KEY_ROTATE';
  payload: {
    channelId: string;
    reason: 'kick' | 'manual' | 'scheduled';
    /** New bundles for remaining members. */
    bundles: Array<{
      recipientPublicKey: string;
      encryptedKey: string;
      nonce: string;
    }>;
    distributorPublicKey: string;
  };
  timestamp: number;
}

// =================================================================
// Relay → Client
// =================================================================

/** Response with encrypted group keys for the requesting user. */
export interface GroupKeyResponseMsg {
  type: 'GROUP_KEY_RESPONSE';
  payload: {
    channelId: string;
    config: ChannelCryptoConfig;
    /** Key epochs available to this user (filtered by historyAccess). */
    epochs: KeyEpoch[];
  };
  timestamp: number;
}

/** Notification that the group key was rotated. */
export interface GroupKeyRotatedMsg {
  type: 'GROUP_KEY_ROTATED';
  payload: {
    channelId: string;
    epoch: number;
    /** Encrypted key for this specific recipient. */
    encryptedKey: string;
    nonce: string;
    distributorPublicKey: string;
    reason: string;
  };
  timestamp: number;
}

/** Encrypted message payload (wraps the normal message content). */
export interface EncryptedPayload {
  /** The encrypted content (base64). */
  ciphertext: string;
  /** Nonce used (hex). */
  nonce: string;
  /** Which key epoch was used to encrypt. */
  epoch: number;
  /** Indicates this is an encrypted message. */
  encrypted: true;
}
