/**
 * DB store — manages the MusterDB instance lifecycle.
 *
 * The MusterDB is created after login (needs the user's keypair context)
 * and destroyed on logout. It is shared across all other stores.
 */

import { create } from 'zustand';
import type { MusterDB } from '@muster/db';

interface DBState {
  db: MusterDB | null;
  dbStatus: 'idle' | 'starting' | 'ready' | 'error';
  dbError: string | null;

  /** Initialise MusterDB — call after the P2P node is connected */
  initDB: () => Promise<void>;

  /** Shut down MusterDB — call on logout */
  closeDB: () => Promise<void>;
}

export const useDBStore = create<DBState>()((set, get) => ({
  db:       null,
  dbStatus: 'idle',
  dbError:  null,

  initDB: async () => {
    if (get().dbStatus === 'ready' || get().dbStatus === 'starting') return;
    set({ dbStatus: 'starting', dbError: null });

    try {
      // Dynamic import so the heavy OrbitDB/Helia bundle is only loaded when needed
      const { MusterDB } = await import('@muster/db');
      const db = await MusterDB.create();
      set({ db, dbStatus: 'ready' });
      console.log('[DB] MusterDB ready (browser in-memory mode)');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[DB] Failed to initialise MusterDB:', err);
      set({ dbStatus: 'error', dbError: msg });
    }
  },

  closeDB: async () => {
    const { db } = get();
    if (db) {
      try {
        await db.close();
      } catch (err) {
        console.warn('[DB] Error closing MusterDB:', err);
      }
    }
    set({ db: null, dbStatus: 'idle', dbError: null });
  },
}));
