/**
 * DB store — OrbitDB disabled in browser (Helia/WASM compatibility issues).
 * Browser uses localStorage + GossipSub for persistence and sync.
 * OrbitDB will run on dedicated nodes in a future phase.
 */

import { create } from 'zustand';

// Minimal MusterDB interface — browser version is a no-op
export interface BrowserDB {
  openMessageLog: (communityId: string, channelId: string) => Promise<{ add: (m: any) => Promise<void>; all: () => any[] }>;
  openCommunity: (communityId: string) => Promise<{ getMeta: () => Promise<null>; setMeta: (m: any) => Promise<void>; setMember: (m: any) => Promise<void> }>;
  getUserRegistry: () => Promise<{ getByUsername: () => Promise<null>; register: () => Promise<void> }>;
  persistMessage: (m: any) => Promise<void>;
  close: () => Promise<void>;
}

// No-op browser DB — all operations are silent no-ops
const createBrowserDB = (): BrowserDB => ({
  openMessageLog: async () => ({ add: async () => {}, all: () => [] }),
  openCommunity:  async () => ({ getMeta: async () => null, setMeta: async () => {}, setMember: async () => {} }),
  getUserRegistry: async () => ({ getByUsername: async () => null, register: async () => {} }),
  persistMessage: async () => {},
  close:          async () => {},
});

interface DBState {
  db: BrowserDB | null;
  dbStatus: 'idle' | 'starting' | 'ready' | 'error';
  dbError: string | null;
  initDB: () => Promise<void>;
  closeDB: () => Promise<void>;
  waitForDB: (timeoutMs?: number) => Promise<BrowserDB | null>;
}

export const useDBStore = create<DBState>()((set, get) => ({
  db:       null,
  dbStatus: 'idle',
  dbError:  null,

  initDB: async () => {
    if (get().dbStatus === 'ready' || get().dbStatus === 'starting') return;
    set({ dbStatus: 'starting' });
    // Use no-op browser DB — instant, no dependencies
    const db = createBrowserDB();
    set({ db, dbStatus: 'ready' });
    console.log('[DB] Browser DB ready (localStorage mode)');
  },

  closeDB: async () => {
    set({ db: null, dbStatus: 'idle', dbError: null });
  },

  waitForDB: async (_timeoutMs = 15000): Promise<BrowserDB | null> => {
    if (get().dbStatus === 'idle') get().initDB();
    // Browser DB is synchronous — ready immediately
    let waited = 0;
    while (get().dbStatus !== 'ready' && waited < 3000) {
      await new Promise((r) => setTimeout(r, 100));
      waited += 100;
    }
    return get().db;
  },
}));
