/**
 * Friend System Protocol Messages — R11
 *
 * ADD to packages/protocol/src/ and re-export from index.ts:
 *   export * from './friend-messages.js';
 */

// =================================================================
// Friend request states
// =================================================================

export type FriendRequestStatus = 'pending' | 'accepted' | 'declined' | 'blocked';

export interface FriendRequest {
  id: string;
  fromPublicKey: string;
  fromUsername: string;
  toPublicKey: string;
  toUsername: string;
  status: FriendRequestStatus;
  createdAt: number;
}

export interface Friend {
  publicKey: string;
  username: string;
  displayName: string;
  since: number;
}

// =================================================================
// Client → Relay
// =================================================================

/** Send a friend request to another user by username. */
export interface SendFriendRequestMsg {
  type: 'SEND_FRIEND_REQUEST';
  payload: { targetUsername: string };
  timestamp: number;
}

/** Respond to an incoming friend request. */
export interface RespondFriendRequestMsg {
  type: 'RESPOND_FRIEND_REQUEST';
  payload: {
    requestId: string;
    action: 'accept' | 'decline' | 'block';
  };
  timestamp: number;
}

/** Remove an existing friend. */
export interface RemoveFriendMsg {
  type: 'REMOVE_FRIEND';
  payload: { publicKey: string };
  timestamp: number;
}

/** Cancel an outgoing friend request. */
export interface CancelFriendRequestMsg {
  type: 'CANCEL_FRIEND_REQUEST';
  payload: { requestId: string };
  timestamp: number;
}

/** Block a user (prevents DMs and friend requests). */
export interface BlockUserMsg {
  type: 'BLOCK_USER';
  payload: { publicKey: string };
  timestamp: number;
}

/** Unblock a user. */
export interface UnblockUserMsg {
  type: 'UNBLOCK_USER';
  payload: { publicKey: string };
  timestamp: number;
}

/** Request the current friend list. */
export interface GetFriendsMsg {
  type: 'GET_FRIENDS';
  timestamp: number;
}

/** Request pending friend requests (incoming + outgoing). */
export interface GetFriendRequestsMsg {
  type: 'GET_FRIEND_REQUESTS';
  timestamp: number;
}

/** Request blocked users list. */
export interface GetBlockedUsersMsg {
  type: 'GET_BLOCKED_USERS';
  timestamp: number;
}

// =================================================================
// Relay → Client
// =================================================================

/** Friend list response. */
export interface FriendListMsg {
  type: 'FRIEND_LIST';
  payload: { friends: Friend[] };
  timestamp: number;
}

/** Pending friend requests response. */
export interface FriendRequestListMsg {
  type: 'FRIEND_REQUEST_LIST';
  payload: {
    incoming: FriendRequest[];
    outgoing: FriendRequest[];
  };
  timestamp: number;
}

/** A new friend request was received. */
export interface FriendRequestReceivedMsg {
  type: 'FRIEND_REQUEST_RECEIVED';
  payload: FriendRequest;
  timestamp: number;
}

/** A friend request was accepted — new friend added. */
export interface FriendAddedMsg {
  type: 'FRIEND_ADDED';
  payload: Friend;
  timestamp: number;
}

/** A friend was removed. */
export interface FriendRemovedMsg {
  type: 'FRIEND_REMOVED';
  payload: { publicKey: string };
  timestamp: number;
}

/** Blocked users list. */
export interface BlockedUsersListMsg {
  type: 'BLOCKED_USERS_LIST';
  payload: { users: Array<{ publicKey: string; username: string; blockedAt: number }> };
  timestamp: number;
}

/** Generic friend system result. */
export interface FriendResultMsg {
  type: 'FRIEND_RESULT';
  payload: {
    action: string;
    success: boolean;
    message?: string;
  };
  timestamp: number;
}
