/**
 * @muster/protocol — message type definitions (Phase 1)
 *
 * Every object sent over the Muster network is one of these types.
 * They are serialised to JSON, signed, then sent via GossipSub or WebSocket.
 *
 * Naming convention:
 *   - Types ending in  `Message`  are sent between peers in real time
 *   - Types ending in  `Event`    are persisted in OrbitDB (immutable log)
 *   - Types ending in  `Request`  are sent from client → node (RPC-style)
 *   - Types ending in  `Response` are sent from node → client
 */

// ─── Message types ─────────────────────────────────────────────────────────

/** Every network message shares these base fields */
export interface BaseMessage {
  /** Message format version — increment when making breaking changes */
  v: 1;
  /** Unique message ID (UUID v4) */
  id: string;
  /** Unix timestamp in milliseconds when the message was created */
  ts: number;
  /** Hex-encoded Ed25519 public key of the sender */
  senderPublicKeyHex: string;
}

/** Types of messages that can be sent */
export type MessageType =
  | 'chat.text'
  | 'chat.edit'
  | 'chat.delete'
  | 'chat.reaction'
  | 'peer.announce'
  | 'peer.leave'
  | 'channel.join'
  | 'channel.leave'
  | 'community.update';

// ─── Chat messages ──────────────────────────────────────────────────────────

/** A text message sent to a community channel */
export interface TextMessage extends BaseMessage {
  type: 'chat.text';
  /** Community ID this message belongs to */
  communityId: string;
  /** Channel ID within the community */
  channelId: string;
  /**
   * Message content — plain text for now.
   * Phase 2 will add markdown parsing client-side (content stays as plain text on the wire).
   */
  content: string;
  /** Optional: ID of the message being replied to (for thread support) */
  replyToId?: string;
}

/** Edit an existing message (sender only) */
export interface EditMessage extends BaseMessage {
  type: 'chat.edit';
  communityId: string;
  channelId: string;
  /** ID of the original TextMessage being edited */
  targetMessageId: string;
  /** New content — replaces the original */
  newContent: string;
}

/** Delete a message (sender or community admin) */
export interface DeleteMessage extends BaseMessage {
  type: 'chat.delete';
  communityId: string;
  channelId: string;
  /** ID of the message to delete */
  targetMessageId: string;
}

/** Add or remove a reaction on a message */
export interface ReactionMessage extends BaseMessage {
  type: 'chat.reaction';
  communityId: string;
  channelId: string;
  targetMessageId: string;
  /** Unicode emoji character, e.g. "👍" */
  emoji: string;
  /** true = add reaction, false = remove reaction */
  add: boolean;
}

// ─── Peer presence ──────────────────────────────────────────────────────────

/** Broadcast when a peer connects to a community */
export interface PeerAnnounceMessage extends BaseMessage {
  type: 'peer.announce';
  communityId: string;
  /** Human-readable username */
  username: string;
  /** Optional display name (may differ from username) */
  displayName?: string;
}

/** Broadcast when a peer disconnects cleanly */
export interface PeerLeaveMessage extends BaseMessage {
  type: 'peer.leave';
  communityId: string;
}

// ─── Channel events ─────────────────────────────────────────────────────────

export interface ChannelJoinMessage extends BaseMessage {
  type: 'channel.join';
  communityId: string;
  channelId: string;
}

export interface ChannelLeaveMessage extends BaseMessage {
  type: 'channel.leave';
  communityId: string;
  channelId: string;
}

// ─── Union type ─────────────────────────────────────────────────────────────

/** Any message that can travel over the Muster network */
export type MusterMessage =
  | TextMessage
  | EditMessage
  | DeleteMessage
  | ReactionMessage
  | PeerAnnounceMessage
  | PeerLeaveMessage
  | ChannelJoinMessage
  | ChannelLeaveMessage;
