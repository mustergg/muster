/**
 * @muster/db — shared types for all OrbitDB stores
 *
 * These types define the shape of documents stored in each OrbitDB database.
 * They are separate from the protocol message types — a stored document is
 * the persisted form, while a protocol message is the in-flight form.
 */

// ─── Stored message (persisted in MessageLog) ────────────────────────────────

/**
 * A chat message as stored in OrbitDB.
 * This is the canonical persisted form — richer than the wire format.
 */
export interface StoredChatMessage {
  /** Unique message ID (UUID v4) */
  id: string;
  /** Community this message belongs to */
  communityId: string;
  /** Channel within the community */
  channelId: string;
  /** Hex-encoded public key of the sender */
  senderPublicKeyHex: string;
  /** Sender's username at time of writing (cached for display) */
  senderUsername: string;
  /** Message content */
  content: string;
  /** Optional: ID of the message being replied to */
  replyToId?: string;
  /** Optional: CIDs of attached files */
  attachmentCids?: string[];
  /** Unix timestamp in milliseconds */
  ts: number;
  /** Ed25519 signature of the message envelope */
  signature: string;
  /** Whether this message has been edited */
  edited?: boolean;
  /** Timestamp of last edit */
  editedAt?: number;
  /** Whether this message has been deleted (tombstone) */
  deleted?: boolean;
}

// ─── Stored community ────────────────────────────────────────────────────────

export type ChannelType = 'text' | 'voice' | 'voice-temp' | 'feed';
export type ChannelVisibility = 'public' | 'private' | 'readonly' | 'archived';
export type CommunityType = 'public' | 'public-approval' | 'private' | 'secret';

export interface StoredChannel {
  id: string;
  name: string;
  type: ChannelType;
  visibility: ChannelVisibility;
  topic?: string;
  position: number;
  categoryId?: string;
}

export interface StoredCategory {
  id: string;
  name: string;
  position: number;
}

export type CommunityRole = 'owner' | 'admin' | 'moderator' | 'member';

export interface StoredCommunityMember {
  publicKeyHex: string;
  username: string;
  role: CommunityRole;
  customRoleIds: string[];
  joinedAt: number;
}

export interface StoredCommunity {
  id: string;
  name: string;
  description?: string;
  type: CommunityType;
  iconCid?: string;
  ownerPublicKeyHex: string;
  channels: StoredChannel[];
  categories: StoredCategory[];
  hostNodePeerIds: string[];
  createdAt: number;
  updatedAt: number;
  version: 1;
}

// ─── User profile (stored in UserRegistry) ───────────────────────────────────

export interface StoredUserProfile {
  /** Hex-encoded Ed25519 public key — canonical identity */
  publicKeyHex: string;
  /** Unique username */
  username: string;
  /** SHA-256 hash of the email — never the email itself */
  emailHash?: string;
  /** Whether the email has been verified */
  emailVerified: boolean;
  /** Optional display name */
  displayName?: string;
  /** CID of the avatar image */
  avatarCid?: string;
  /** Short bio */
  bio?: string;
  /** Unix timestamp of last profile update */
  updatedAt: number;
  /** Unix timestamp of account creation */
  createdAt: number;
}

// ─── Presence (online/offline status) ────────────────────────────────────────

export type PresenceStatus = 'online' | 'busy' | 'away' | 'invisible';

export interface PresenceEntry {
  publicKeyHex: string;
  username: string;
  status: PresenceStatus;
  /** Unix timestamp of last presence update */
  lastSeen: number;
  /** Which community this presence is for */
  communityId: string;
}

// ─── Store addresses (OrbitDB database addresses) ────────────────────────────

/**
 * Maps resource IDs to their OrbitDB database addresses.
 * Stored locally and shared via DHT so peers can open the same databases.
 */
export interface StoreAddresses {
  /** community ID → OrbitDB address of its MessageLog */
  channelLogs: Record<string, string>;
  /** community ID → OrbitDB address of its CommunityStore */
  communityStores: Record<string, string>;
  /** 'global' → OrbitDB address of the UserRegistry */
  userRegistry: string;
}
