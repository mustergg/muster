/**
 * @muster/protocol — permissions & moderation schema (Phase 1: types only)
 *
 * These types define the complete permission model for Muster communities.
 * They are used as the shared contract between all apps and packages.
 *
 * ENFORCEMENT STATUS:
 *   Phase 1 — types defined here, no runtime enforcement yet
 *   Phase 2 — OrbitDB AccessController + main node GossipSub validation
 *
 * ROLE HIERARCHY (highest → lowest):
 *   Owner → Admin → Moderator → [Custom roles] → Member
 */

// ─── Fixed roles ─────────────────────────────────────────────────────────────

/**
 * The four fixed community roles.
 * Every community member is assigned exactly one fixed role.
 * Custom roles are additive on top of 'member'.
 */
export type FixedRole = 'owner' | 'admin' | 'moderator' | 'member';

/**
 * Numeric priority for fixed roles (lower = more authority).
 * Used for "can Actor act on Target?" checks.
 */
export const FIXED_ROLE_PRIORITY: Record<FixedRole, number> = {
  owner:     1,
  admin:     2,
  moderator: 3,
  member:    4,
} as const;

/**
 * Returns true if `actor` has strictly higher authority than `target`.
 * Used to prevent e.g. a Moderator from banning an Admin.
 *
 * @example
 * canActOn('moderator', 'member')   // true
 * canActOn('moderator', 'admin')    // false
 * canActOn('admin',     'admin')    // false — cannot act on equal level
 */
export function canActOn(actor: FixedRole, target: FixedRole): boolean {
  return FIXED_ROLE_PRIORITY[actor] < FIXED_ROLE_PRIORITY[target];
}

// ─── Channel visibility states ───────────────────────────────────────────────

/**
 * The four channel visibility states.
 *
 * public   — all community members can see and write
 * private  — only roles/members in the allowlist can see (and write unless readonly)
 * readonly — visible to all (or allowlist if also private), but only Owner/Admin/Mod can write
 * archived — visible to all, nobody can write, GossipSub topic is closed
 */
export type ChannelVisibility = 'public' | 'private' | 'readonly' | 'archived';

// ─── Grantable permission keys ────────────────────────────────────────────────

/**
 * The complete set of permissions that can be explicitly granted to custom roles.
 * Custom roles can only hold permissions from this set (≤ Moderator ceiling).
 *
 * Naming convention: <domain>.<action>
 */
export type GrantablePermission =
  | 'messages.send'
  | 'messages.pin'
  | 'messages.delete_any'
  | 'channels.create_temp'
  | 'channels.set_readonly'
  | 'members.invite'
  | 'members.kick'
  | 'members.ban'
  | 'members.timeout'
  | 'streams.start'
  | 'voice.mute_others'
  | 'voice.move_members';

/**
 * All permissions (fixed-role exclusive + grantable).
 * Used in audit log entries to record exactly what action was performed.
 */
export type Permission =
  | GrantablePermission
  // Fixed-role exclusive (not grantable to custom roles)
  | 'channels.create'
  | 'channels.delete'
  | 'channels.edit'
  | 'channels.set_private'
  | 'channels.set_archived'
  | 'channels.restore_archived'
  | 'channels.reorder'
  | 'channels.manage_overrides'
  | 'messages.edit_any'
  | 'members.assign_moderator'
  | 'members.revoke_moderator'
  | 'members.assign_admin'
  | 'members.revoke_admin'
  | 'members.assign_custom_role'
  | 'members.revoke_custom_role'
  | 'members.kick_admin'
  | 'members.ban_admin'
  | 'community.edit_settings'
  | 'community.create_custom_roles'
  | 'community.delete_custom_roles'
  | 'community.view_audit_log'
  | 'community.export_audit_log'
  | 'community.manage_invites'
  | 'community.configure_nodes'
  | 'community.transfer_ownership'
  | 'community.delete'
  | 'streams.end_any'
  | 'streams.configure_slots'
  | 'voice.deafen_others'
  | 'voice.kick_from_voice';

// ─── Custom role ─────────────────────────────────────────────────────────────

/**
 * Per-channel permission override for a custom role or individual member.
 * Stored inside the channel document.
 */
export interface ChannelPermissionOverride {
  /**
   * Either a custom role ID or the hex-encoded public key of a specific member.
   * If both are present on different overrides, member-level overrides take priority.
   */
  customRoleId?: string;
  memberPublicKeyHex?: string;
  /** Permissions explicitly granted for this channel (beyond the role's normal set) */
  grant: GrantablePermission[];
  /** Permissions explicitly denied for this channel (even if the role normally has them) */
  deny: GrantablePermission[];
}

/**
 * A custom role defined by the community owner or admin.
 *
 * Custom roles are additive — members with custom roles gain permissions
 * on top of their baseline Member permissions.
 * Custom roles can never exceed Moderator-level authority.
 */
export interface CustomRole {
  /** UUID v4 */
  id: string;
  /** Display name shown in the UI (e.g. 'Artist', 'VIP', 'Event Host') */
  name: string;
  /** Hex colour shown next to the member's name (e.g. '#e040fb') */
  color: string;
  /** Permissions granted to holders of this custom role */
  permissions: GrantablePermission[];
  /** Per-channel access grants/denials for this role */
  channelOverrides: {
    channelId: string;
    grant: GrantablePermission[];
    deny: GrantablePermission[];
  }[];
  /** Public key of the Admin/Owner who created this role */
  createdByPublicKeyHex: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Audit log ───────────────────────────────────────────────────────────────

/**
 * All auditable administrative event types.
 */
export type AuditEventType =
  | 'member.joined'
  | 'member.left'
  | 'member.kicked'
  | 'member.banned'
  | 'member.unbanned'
  | 'member.timed_out'
  | 'role.assigned'
  | 'role.revoked'
  | 'message.deleted_by_mod'
  | 'message.edited_by_admin'
  | 'channel.created'
  | 'channel.deleted'
  | 'channel.visibility_changed'
  | 'channel.settings_changed'
  | 'community.settings_changed'
  | 'community.ownership_transferred'
  | 'community.deleted'
  | 'custom_role.created'
  | 'custom_role.updated'
  | 'custom_role.deleted'
  | 'stream.ended_by_admin';

/**
 * A single immutable audit log entry.
 *
 * Stored in OrbitDB (Phase 2). The actor's Ed25519 signature over the
 * payload makes entries tamper-evident.
 */
export interface AuditLogEntry {
  /** UUID v4 */
  id: string;
  communityId: string;
  type: AuditEventType;
  /** Public key of the member who performed the action */
  actorPublicKeyHex: string;
  /** Public key of the member who was affected (if applicable) */
  targetPublicKeyHex?: string;
  /**
   * Structured payload specific to the event type.
   * e.g. for 'channel.visibility_changed': { channelId, oldState, newState }
   */
  payload: Record<string, unknown>;
  /** Ed25519 signature of the actor over (id + communityId + type + payload) */
  signature: string;
  /** Unix timestamp in milliseconds */
  ts: number;
}

// ─── Community permission helpers ────────────────────────────────────────────

/**
 * Effective permissions for a community member.
 * Computed at runtime from their fixed role + all assigned custom roles.
 * Not stored — derived on-the-fly when needed.
 */
export interface EffectivePermissions {
  fixedRole: FixedRole;
  customRoleIds: string[];
  /** Union of all granted permissions from the fixed role and all custom roles */
  granted: Set<Permission>;
  /**
   * Per-channel overrides: channelId → { grant, deny }
   * Applied on top of the base granted set when evaluating channel-specific access.
   */
  channelOverrides: Map<string, { grant: Set<GrantablePermission>; deny: Set<GrantablePermission> }>;
}

/**
 * The default permissions held by each fixed role.
 * Used to derive EffectivePermissions without needing the full community document.
 *
 * Note: Owner has all permissions — represented as a special case in enforcement logic.
 */
export const DEFAULT_FIXED_ROLE_PERMISSIONS: Record<FixedRole, Permission[]> = {
  owner: [], // Owner bypasses all permission checks — handled separately

  admin: [
    'messages.send', 'messages.pin', 'messages.delete_any', 'messages.edit_any',
    'channels.create', 'channels.delete', 'channels.edit', 'channels.create_temp',
    'channels.set_private', 'channels.set_readonly', 'channels.set_archived',
    'channels.restore_archived', 'channels.reorder', 'channels.manage_overrides',
    'members.invite', 'members.kick', 'members.ban', 'members.timeout', 'members.unban',
    'members.assign_moderator', 'members.revoke_moderator',
    'members.assign_custom_role', 'members.revoke_custom_role',
    'community.edit_settings', 'community.create_custom_roles', 'community.delete_custom_roles',
    'community.view_audit_log', 'community.export_audit_log', 'community.manage_invites',
    'streams.start', 'streams.end_any', 'streams.configure_slots',
    'voice.mute_others', 'voice.deafen_others', 'voice.move_members', 'voice.kick_from_voice',
  ] as Permission[],

  moderator: [
    'messages.send', 'messages.pin', 'messages.delete_any',
    'channels.create_temp', 'channels.set_readonly',
    'members.invite', 'members.kick', 'members.ban', 'members.timeout',
    'community.view_audit_log', 'community.manage_invites',
    'voice.mute_others', 'voice.move_members', 'voice.kick_from_voice',
  ] as Permission[],

  member: [
    'messages.send',
    'members.invite', // Revocable per-community
  ] as Permission[],
} as const;
