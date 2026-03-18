/**
 * @muster/protocol — community and channel data schemas
 *
 * These objects are stored in OrbitDB on main nodes and
 * synchronised to clients on connect.
 */

import type { ChannelVisibility, FixedRole, CustomRole, ChannelPermissionOverride } from './permissions.js';

export type { ChannelVisibility };

// ─── Community ──────────────────────────────────────────────────────────────

export type ChannelType = 'text' | 'voice' | 'voice-temp';

export interface Channel {
  /** Unique channel ID (UUID v4) */
  id: string;
  /** Display name, e.g. "general" */
  name: string;
  /** Channel type */
  type: ChannelType;
  /** Visibility state — enforced by node in Phase 2 */
  visibility: ChannelVisibility;
  /** Optional description / topic */
  topic?: string;
  /** Display order within its category (lower = higher in list) */
  position: number;
  /** Category ID this channel belongs to (if any) */
  categoryId?: string;
  /**
   * Per-role or per-member permission overrides for this channel.
   * Evaluated in Phase 2 during GossipSub topic access checks.
   */
  permissionOverrides: ChannelPermissionOverride[];
}

export interface Category {
  id: string;
  name: string;
  position: number;
}

/** Re-export FixedRole as CommunityRole for backwards compatibility */
export type CommunityRole = FixedRole;

export interface CommunityMember {
  /** Hex-encoded Ed25519 public key */
  publicKeyHex: string;
  username: string;
  role: CommunityRole;
  /** IDs of any custom roles assigned to this member */
  customRoleIds: string[];
  /** ISO timestamp when this member joined */
  joinedAt: string;
}

/**
 * The full community document — stored and signed by the community owner.
 * Any update to this document must be signed with the owner's private key.
 */
export interface Community {
  /** Unique community ID — SHA-256 hash of (ownerPublicKeyHex + createdAt) */
  id: string;
  /** Display name */
  name: string;
  /** Optional description */
  description?: string;
  /** CID (content hash) of the community icon image */
  iconCid?: string;
  /** Hex-encoded Ed25519 public key of the community owner */
  ownerPublicKeyHex: string;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last metadata update */
  updatedAt: string;
  /** Community channels */
  channels: Channel[];
  /** Optional channel categories */
  categories: Category[];
  /** Custom roles defined for this community */
  customRoles: CustomRole[];
  /**
   * Peer IDs of main nodes that are hosting this community.
   * Clients connect to these nodes to get message history.
   */
  hostNodePeerIds: string[];
  /** Community format version */
  version: 1;
}

// ─── User profile ────────────────────────────────────────────────────────────

/**
 * Public user profile — stored in the P2P user registry.
 * All updates must be signed with the user's private key.
 */
export interface UserProfile {
  /** Hex-encoded Ed25519 public key — the user's canonical identity */
  publicKeyHex: string;
  /** Unique username */
  username: string;
  /** Optional display name (shown in UI instead of username if set) */
  displayName?: string;
  /** CID of the avatar image */
  avatarCid?: string;
  /** Short bio */
  bio?: string;
  /** ISO timestamp of last profile update */
  updatedAt: string;
}
