/**
 * DM & Role Protocol Messages — R4
 *
 * ADD THIS FILE to packages/protocol/src/ and re-export from index.ts:
 *   export * from './dm-messages';
 */

// =================================================================
// Direct Messages
// =================================================================

/** Send a DM to another user. Client → Relay. */
export interface SendDMMsg {
  type: 'SEND_DM';
  payload: {
    recipientPublicKey: string;
    content: string;
    messageId: string;
    timestamp: number;
  };
  signature: string;
  senderPublicKey: string;
}

/** Receive a DM. Relay → Client. */
export interface ReceiveDMMsg {
  type: 'DM_MESSAGE';
  payload: {
    messageId: string;
    content: string;
    senderPublicKey: string;
    senderUsername: string;
    recipientPublicKey: string;
    timestamp: number;
  };
  signature: string;
}

/** Request DM history with a specific user. Client → Relay. */
export interface DMHistoryRequestMsg {
  type: 'DM_HISTORY_REQUEST';
  payload: {
    otherPublicKey: string;
    since: number;
  };
  timestamp: number;
}

/** DM history response. Relay → Client. */
export interface DMHistoryResponseMsg {
  type: 'DM_HISTORY_RESPONSE';
  payload: {
    otherPublicKey: string;
    messages: Array<{
      messageId: string;
      content: string;
      senderPublicKey: string;
      senderUsername: string;
      recipientPublicKey: string;
      timestamp: number;
    }>;
  };
  timestamp: number;
}

/** Request list of DM conversations. Client → Relay. */
export interface DMConversationsRequestMsg {
  type: 'DM_CONVERSATIONS_REQUEST';
  payload: {};
  timestamp: number;
}

/** List of DM conversations. Relay → Client. */
export interface DMConversationsResponseMsg {
  type: 'DM_CONVERSATIONS_RESPONSE';
  payload: {
    conversations: Array<{
      publicKey: string;
      username: string;
      lastMessage: string;
      lastTimestamp: number;
      unreadCount: number;
    }>;
  };
  timestamp: number;
}

// =================================================================
// Roles
// =================================================================

/** Assign a role to a community member. Client → Relay. */
export interface AssignRoleMsg {
  type: 'ASSIGN_ROLE';
  payload: {
    communityId: string;
    targetPublicKey: string;
    role: 'admin' | 'moderator' | 'member';
  };
  timestamp: number;
}

/** Role assigned confirmation. Relay → Client(s). */
export interface RoleUpdatedMsg {
  type: 'ROLE_UPDATED';
  payload: {
    communityId: string;
    targetPublicKey: string;
    targetUsername: string;
    newRole: string;
    assignedBy: string;
  };
  timestamp: number;
}

/** Kick a member from a community. Client → Relay. */
export interface KickMemberMsg {
  type: 'KICK_MEMBER';
  payload: {
    communityId: string;
    targetPublicKey: string;
    reason?: string;
  };
  timestamp: number;
}

/** Delete a message (mod action). Client → Relay. */
export interface DeleteMessageMsg {
  type: 'DELETE_MESSAGE';
  payload: {
    channel: string;
    messageId: string;
  };
  timestamp: number;
}

/** Message deleted notification. Relay → Client(s). */
export interface MessageDeletedMsg {
  type: 'MESSAGE_DELETED';
  payload: {
    channel: string;
    messageId: string;
    deletedBy: string;
  };
  timestamp: number;
}
