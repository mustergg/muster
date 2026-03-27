/**
 * Community Protocol Messages — R3
 *
 * These types define community-related messages between clients and the relay.
 * ADD THIS FILE to packages/protocol/src/ and re-export from index.ts:
 *   export * from './community-messages.js';
 */

// =================================================================
// Shared community data types
// =================================================================

export interface StoredChannel {
  id: string;
  name: string;
  type: 'text' | 'feed' | 'voice' | 'voice-temp';
  visibility: 'public' | 'private' | 'readonly' | 'archived';
  position: number;
}

export interface StoredCommunity {
  id: string;
  name: string;
  description: string;
  type: 'public' | 'public-approval' | 'private' | 'secret';
  ownerPublicKey: string;
  ownerUsername: string;
  channels: StoredChannel[];
  createdAt: number;
  memberCount: number;
}

export interface StoredCommunityMember {
  publicKey: string;
  username: string;
  role: 'owner' | 'admin' | 'moderator' | 'member';
  joinedAt: number;
}

// =================================================================
// Community messages: Client → Relay
// =================================================================

export interface CreateCommunityMsg {
  type: 'CREATE_COMMUNITY';
  payload: { name: string; description?: string };
  timestamp: number;
}

export interface JoinCommunityMsg {
  type: 'JOIN_COMMUNITY';
  payload: { communityId: string };
  timestamp: number;
}

export interface LeaveCommunityMsg {
  type: 'LEAVE_COMMUNITY';
  payload: { communityId: string };
  timestamp: number;
}

export interface ListCommunitiesMsg {
  type: 'LIST_COMMUNITIES';
  payload: {};
  timestamp: number;
}

export interface GetCommunityMsg {
  type: 'GET_COMMUNITY';
  payload: { communityId: string };
  timestamp: number;
}

// =================================================================
// Community messages: Relay → Client
// =================================================================

export interface CommunityCreatedMsg {
  type: 'COMMUNITY_CREATED';
  payload: { community: StoredCommunity };
  timestamp: number;
}

export interface CommunityJoinedMsg {
  type: 'COMMUNITY_JOINED';
  payload: { community: StoredCommunity };
  timestamp: number;
}

export interface CommunitiesListMsg {
  type: 'COMMUNITIES_LIST';
  payload: { communities: StoredCommunity[] };
  timestamp: number;
}

export interface CommunityDataMsg {
  type: 'COMMUNITY_DATA';
  payload: { community: StoredCommunity; members: StoredCommunityMember[] };
  timestamp: number;
}
