/**
 * Squad Protocol Messages — R13
 *
 * ADD to packages/protocol/src/ and re-export from index.ts:
 *   export * from './squad-messages.js';
 */

// =================================================================
// Data types
// =================================================================

export interface Squad {
  id: string;
  communityId: string;
  name: string;
  ownerPublicKey: string;
  ownerUsername: string;
  /** Text channel ID for squad chat */
  textChannelId: string;
  /** Voice channel ID (placeholder until R18) */
  voiceChannelId: string;
  memberCount: number;
  createdAt: number;
}

export interface SquadMember {
  publicKey: string;
  username: string;
  role: 'owner' | 'member';
  joinedAt: number;
}

// =================================================================
// Client → Relay
// =================================================================

export interface CreateSquadMsg {
  type: 'CREATE_SQUAD';
  payload: { communityId: string; name: string };
  timestamp: number;
}

export interface GetSquadsMsg {
  type: 'GET_SQUADS';
  payload: { communityId: string };
  timestamp: number;
}

export interface InviteToSquadMsg {
  type: 'INVITE_TO_SQUAD';
  payload: { squadId: string; targetUsername: string };
  timestamp: number;
}

export interface LeaveSquadMsg {
  type: 'LEAVE_SQUAD';
  payload: { squadId: string };
  timestamp: number;
}

export interface KickFromSquadMsg {
  type: 'KICK_FROM_SQUAD';
  payload: { squadId: string; publicKey: string };
  timestamp: number;
}

export interface DeleteSquadMsg {
  type: 'DELETE_SQUAD';
  payload: { squadId: string };
  timestamp: number;
}

export interface GetSquadMembersMsg {
  type: 'GET_SQUAD_MEMBERS';
  payload: { squadId: string };
  timestamp: number;
}

/** Subscribe to squad text channel for messages. */
export interface SubscribeSquadMsg {
  type: 'SUBSCRIBE_SQUAD';
  payload: { squadId: string };
  timestamp: number;
}

/** Send a message in a squad text channel. */
export interface SendSquadMessageMsg {
  type: 'SEND_SQUAD_MESSAGE';
  payload: { squadId: string; content: string; messageId: string };
  timestamp: number;
}

/** Request message history for a squad text channel. */
export interface SquadHistoryRequestMsg {
  type: 'SQUAD_HISTORY_REQUEST';
  payload: { squadId: string; since: number };
  timestamp: number;
}

// =================================================================
// Relay → Client
// =================================================================

export interface SquadCreatedMsg {
  type: 'SQUAD_CREATED';
  payload: Squad;
  timestamp: number;
}

export interface SquadListMsg {
  type: 'SQUAD_LIST';
  payload: { communityId: string; squads: Squad[] };
  timestamp: number;
}

export interface SquadDeletedMsg {
  type: 'SQUAD_DELETED';
  payload: { squadId: string; communityId: string };
  timestamp: number;
}

export interface SquadMemberListMsg {
  type: 'SQUAD_MEMBER_LIST';
  payload: { squadId: string; members: SquadMember[] };
  timestamp: number;
}

export interface SquadMemberJoinedMsg {
  type: 'SQUAD_MEMBER_JOINED';
  payload: { squadId: string; member: SquadMember };
  timestamp: number;
}

export interface SquadMemberLeftMsg {
  type: 'SQUAD_MEMBER_LEFT';
  payload: { squadId: string; publicKey: string };
  timestamp: number;
}

export interface SquadMessageMsg {
  type: 'SQUAD_MESSAGE';
  payload: {
    squadId: string;
    messageId: string;
    content: string;
    senderPublicKey: string;
    senderUsername: string;
    timestamp: number;
  };
  timestamp: number;
}

export interface SquadHistoryResponseMsg {
  type: 'SQUAD_HISTORY_RESPONSE';
  payload: {
    squadId: string;
    messages: Array<{
      messageId: string;
      content: string;
      senderPublicKey: string;
      senderUsername: string;
      timestamp: number;
    }>;
  };
  timestamp: number;
}

export interface SquadResultMsg {
  type: 'SQUAD_RESULT';
  payload: { action: string; success: boolean; message?: string };
  timestamp: number;
}
