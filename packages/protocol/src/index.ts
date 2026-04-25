/**
 * @muster/protocol — public API
 */

export type {
  BaseMessage,
  MessageType,
  TextMessage,
  EditMessage,
  DeleteMessage,
  ReactionMessage,
  PeerAnnounceMessage,
  PeerLeaveMessage,
  ChannelJoinMessage,
  ChannelLeaveMessage,
  MusterMessage,
} from './messages.js';

export type {
  ChannelType,
  Channel,
  Category,
  CommunityRole,
  CommunityMember,
  Community,
  UserProfile,
} from './community.js';

export {
  serialise,
  deserialise,
  generateId,
  now,
} from './serialise.js';

export type {
  FixedRole,
  ChannelVisibility,
  GrantablePermission,
  Permission,
  ChannelPermissionOverride,
  CustomRole,
  AuditEventType,
  AuditLogEntry,
  EffectivePermissions,
} from './permissions.js';

export {
  FIXED_ROLE_PRIORITY,
  DEFAULT_FIXED_ROLE_PERMISSIONS,
  canActOn,
} from './permissions.js';

export * from './ws-messages.js';
export * from './community-messages.js';
export * from './dm-messages.js';
export * from './email-messages.js';
export * from './channel-management-messages.js';
export * from './file-messages.js';
export * from './profile-messages.js';
export * from './friend-messages.js';
export * from './post-messages.js';
export * from './squad-messages.js';
export * from './network-messages.js';
export * from './voice-messages.js';
export * from './group-crypto-messages.js';

// R25 — Phase 1: two-layer envelope + blob model
export * from './envelope.js';
// R25 — Phase 2: signed community manifest
export * from './manifest.js';
// R25 — Phase 3: causal op log
export * from './op.js';
// R25 — Phase 5: BitSwap-lite swarm
export * from './swarm.js';