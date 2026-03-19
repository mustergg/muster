// @ts-nocheck
/**
 * @muster/db — UserRegistry
 *
 * A global key-value OrbitDB store mapping usernames and public keys
 * to user profiles. There is one UserRegistry shared across the network.
 *
 * Keys:
 *   'username:{username}'    → publicKeyHex (for username → pubkey lookup)
 *   'profile:{publicKeyHex}' → StoredUserProfile (full profile)
 *   'email:{emailHash}'      → publicKeyHex (for email uniqueness check)
 */

import type { StoredUserProfile } from '../types.js';

export interface UserRegistryOptions {
  orbitdb: any;
}

export interface UserRegistry {
  /** Look up a profile by username */
  getByUsername: (username: string) => Promise<StoredUserProfile | null>;
  /** Look up a profile by public key hex */
  getByPublicKey: (publicKeyHex: string) => Promise<StoredUserProfile | null>;
  /** Check if a username is taken */
  isUsernameTaken: (username: string) => Promise<boolean>;
  /** Check if an email hash is already registered */
  isEmailTaken: (emailHash: string) => Promise<boolean>;
  /** Register a new user profile */
  register: (profile: StoredUserProfile) => Promise<void>;
  /** Update an existing profile (must be signed — enforcement in Phase 2) */
  update: (profile: StoredUserProfile) => Promise<void>;
  /** Remove a user (on account deletion) */
  remove: (publicKeyHex: string, username: string, emailHash?: string) => Promise<void>;
  address: string;
  close: () => Promise<void>;
}

export async function openUserRegistry(
  options: UserRegistryOptions,
): Promise<UserRegistry> {
  const { orbitdb } = options;

  // Global registry — same name across all nodes
  const db = await orbitdb.open('muster.global.user-registry', {
    type: 'keyvalue',
  });

  return {
    address: db.address,

    getByUsername: async (username: string): Promise<StoredUserProfile | null> => {
      const pubkey = await db.get(`username:${username.toLowerCase()}`);
      if (!pubkey) return null;
      return (await db.get(`profile:${pubkey}`)) as StoredUserProfile | null;
    },

    getByPublicKey: async (publicKeyHex: string): Promise<StoredUserProfile | null> => {
      return (await db.get(`profile:${publicKeyHex}`)) as StoredUserProfile | null;
    },

    isUsernameTaken: async (username: string): Promise<boolean> => {
      const existing = await db.get(`username:${username.toLowerCase()}`);
      return existing != null;
    },

    isEmailTaken: async (emailHash: string): Promise<boolean> => {
      const existing = await db.get(`email:${emailHash}`);
      return existing != null;
    },

    register: async (profile: StoredUserProfile): Promise<void> => {
      await db.put(`username:${profile.username.toLowerCase()}`, profile.publicKeyHex);
      await db.put(`profile:${profile.publicKeyHex}`, profile);
      if (profile.emailHash) {
        await db.put(`email:${profile.emailHash}`, profile.publicKeyHex);
      }
    },

    update: async (profile: StoredUserProfile): Promise<void> => {
      // On update, if username changed, remove the old key
      const existing = await db.get(`profile:${profile.publicKeyHex}`) as StoredUserProfile | null;
      if (existing && existing.username !== profile.username) {
        await db.del(`username:${existing.username.toLowerCase()}`);
      }
      await db.put(`username:${profile.username.toLowerCase()}`, profile.publicKeyHex);
      await db.put(`profile:${profile.publicKeyHex}`, profile);
      if (profile.emailHash) {
        await db.put(`email:${profile.emailHash}`, profile.publicKeyHex);
      }
    },

    remove: async (
      publicKeyHex: string,
      username: string,
      emailHash?: string,
    ): Promise<void> => {
      await db.del(`username:${username.toLowerCase()}`);
      await db.del(`profile:${publicKeyHex}`);
      if (emailHash) await db.del(`email:${emailHash}`);
    },

    close: async (): Promise<void> => {
      await db.close();
    },
  };
}
