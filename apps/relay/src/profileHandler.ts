/**
 * Profile handler — manages user profile CRUD.
 *
 * Handles: UPDATE_PROFILE, GET_PROFILE
 *
 * Profiles are stored in the users table (extended with profile columns).
 */

import { UserDB } from './userDB';
import type { RelayClient } from './types';

export function handleProfileMessage(
  client: RelayClient,
  msg: any,
  userDB: UserDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): void {
  switch (msg.type) {
    case 'UPDATE_PROFILE':
      handleUpdateProfile(client, msg, userDB, sendToClient);
      break;
    case 'GET_PROFILE':
      handleGetProfile(client, msg, userDB, sendToClient);
      break;
  }
}

function handleUpdateProfile(
  client: RelayClient,
  msg: any,
  userDB: UserDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): void {
  const { displayName, displayNameType, bio, links, avatarFileId } = msg.payload || {};

  // Validate displayName length
  if (displayName !== undefined && displayName.length > 64) {
    sendToClient(client, {
      type: 'PROFILE_UPDATED',
      payload: { success: false, message: 'Display name must be 64 characters or fewer.' },
      timestamp: Date.now(),
    });
    return;
  }

  // Validate bio length
  if (bio !== undefined && bio.length > 500) {
    sendToClient(client, {
      type: 'PROFILE_UPDATED',
      payload: { success: false, message: 'Bio must be 500 characters or fewer.' },
      timestamp: Date.now(),
    });
    return;
  }

  // Validate links
  if (links !== undefined && links.length > 5) {
    sendToClient(client, {
      type: 'PROFILE_UPDATED',
      payload: { success: false, message: 'Maximum 5 links allowed.' },
      timestamp: Date.now(),
    });
    return;
  }

  const profile = userDB.updateProfile(client.publicKey, {
    displayName: displayName ?? undefined,
    displayNameType: displayNameType ?? undefined,
    bio: bio ?? undefined,
    links: links ?? undefined,
    avatarFileId: avatarFileId ?? undefined,
  });

  if (!profile) {
    sendToClient(client, {
      type: 'PROFILE_UPDATED',
      payload: { success: false, message: 'User not found.' },
      timestamp: Date.now(),
    });
    return;
  }

  console.log(`[relay] Profile updated: ${client.username}`);

  sendToClient(client, {
    type: 'PROFILE_UPDATED',
    payload: { success: true, profile },
    timestamp: Date.now(),
  });
}

function handleGetProfile(
  client: RelayClient,
  msg: any,
  userDB: UserDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): void {
  const { publicKey } = msg.payload || {};
  if (!publicKey) return;

  const profile = userDB.getProfile(publicKey);
  if (!profile) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'NOT_FOUND', message: 'User not found' },
      timestamp: Date.now(),
    });
    return;
  }

  sendToClient(client, {
    type: 'PROFILE_DATA',
    payload: profile,
    timestamp: Date.now(),
  });
}
