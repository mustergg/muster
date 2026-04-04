/**
 * User Profile Protocol Messages — R10
 *
 * ADD THIS FILE to packages/protocol/src/ and re-export from index.ts:
 *   export * from './profile-messages.js';
 */

// =================================================================
// Profile data
// =================================================================

export type DisplayNameType = 'name' | 'nickname' | 'gamertag';

export interface UserProfile {
  publicKey: string;
  username: string;
  displayName: string;
  displayNameType: DisplayNameType;
  bio: string;
  links: string[];
  avatarFileId: string;
  updatedAt: number;
}

// =================================================================
// Client → Relay
// =================================================================

/** Update the current user's profile. */
export interface UpdateProfileMsg {
  type: 'UPDATE_PROFILE';
  payload: {
    displayName?: string;
    displayNameType?: DisplayNameType;
    bio?: string;
    links?: string[];
    avatarFileId?: string;
  };
  timestamp: number;
}

/** Request another user's profile. */
export interface GetProfileMsg {
  type: 'GET_PROFILE';
  payload: {
    publicKey: string;
  };
  timestamp: number;
}

// =================================================================
// Relay → Client
// =================================================================

/** Profile data response. */
export interface ProfileDataMsg {
  type: 'PROFILE_DATA';
  payload: UserProfile;
  timestamp: number;
}

/** Profile was updated. Sent to the user who updated it. */
export interface ProfileUpdatedMsg {
  type: 'PROFILE_UPDATED';
  payload: {
    success: boolean;
    profile?: UserProfile;
    message?: string;
  };
  timestamp: number;
}
