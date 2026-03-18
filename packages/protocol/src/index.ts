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
