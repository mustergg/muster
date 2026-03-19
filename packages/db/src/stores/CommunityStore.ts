// @ts-nocheck
/**
 * @muster/db — CommunityStore
 *
 * A key-value OrbitDB store holding the community document, channel list,
 * and member roster. One CommunityStore per community.
 *
 * Keys:
 *   'meta'            → StoredCommunity (community document)
 *   'member:{pubkey}' → StoredCommunityMember
 */

import type { StoredCommunity, StoredCommunityMember } from '../types.js';

export interface CommunityStoreOptions {
  orbitdb: any;
  communityId: string;
}

export interface CommunityStore {
  /** Get the community document */
  getMeta: () => Promise<StoredCommunity | null>;
  /** Save or update the community document */
  setMeta: (community: StoredCommunity) => Promise<void>;
  /** Get a member by public key */
  getMember: (publicKeyHex: string) => Promise<StoredCommunityMember | null>;
  /** Add or update a member */
  setMember: (member: StoredCommunityMember) => Promise<void>;
  /** Remove a member */
  removeMember: (publicKeyHex: string) => Promise<void>;
  /** Get all members */
  allMembers: () => Promise<StoredCommunityMember[]>;
  /** The OrbitDB database address */
  address: string;
  close: () => Promise<void>;
}

export async function openCommunityStore(
  options: CommunityStoreOptions,
): Promise<CommunityStore> {
  const { orbitdb, communityId } = options;
  const dbName = `muster.${communityId}.community`;

  const db = await orbitdb.open(dbName, { type: 'keyvalue' });

  return {
    address: db.address,

    getMeta: async (): Promise<StoredCommunity | null> => {
      return (await db.get('meta')) as StoredCommunity | null;
    },

    setMeta: async (community: StoredCommunity): Promise<void> => {
      await db.put('meta', community);
    },

    getMember: async (publicKeyHex: string): Promise<StoredCommunityMember | null> => {
      return (await db.get(`member:${publicKeyHex}`)) as StoredCommunityMember | null;
    },

    setMember: async (member: StoredCommunityMember): Promise<void> => {
      await db.put(`member:${member.publicKeyHex}`, member);
    },

    removeMember: async (publicKeyHex: string): Promise<void> => {
      await db.del(`member:${publicKeyHex}`);
    },

    allMembers: async (): Promise<StoredCommunityMember[]> => {
      const members: StoredCommunityMember[] = [];
      for await (const { key, value } of db.iterator()) {
        if (key.startsWith('member:') && value) {
          members.push(value as StoredCommunityMember);
        }
      }
      return members;
    },

    close: async (): Promise<void> => {
      await db.close();
    },
  };
}
