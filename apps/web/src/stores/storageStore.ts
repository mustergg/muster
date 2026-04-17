/**
 * Storage Store — R21
 *
 * User-configurable data retention and cache management.
 *
 * Options (like browser history):
 *   - Keep everything permanently
 *   - Auto-purge cache every N days
 *   - Keep only "viewed/accessed" content
 *   - Per-community/squad/DM overrides (keep forever, purge after N days, delete now)
 */

import { create } from 'zustand';
import { useNetworkStore } from './networkStore';

// =================================================================
// Types
// =================================================================

export type RetentionMode = 'keep_all' | 'auto_purge' | 'viewed_only';

export interface RetentionOverride {
  id: string;
  type: 'community' | 'squad' | 'dm';
  name: string;
  mode: 'keep' | 'purge' | 'delete';
  /** Days for purge mode (0 = permanent). */
  purgeDays: number;
}

interface StorageState {
  /** Global retention mode. */
  mode: RetentionMode;
  /** Auto-purge interval in days (for 'auto_purge' mode). */
  purgeDays: number;
  /** Per-item overrides. */
  overrides: RetentionOverride[];
  /** Node tier info (from connected relay). */
  connectedNodeTier: string;
  /** Storage stats from relay. */
  stats: {
    totalMessages: number;
    totalDMs: number;
    hostedCommunities: number;
    cachedCommunities: number;
    retentionDays: number;
  } | null;

  setMode: (mode: RetentionMode) => void;
  setPurgeDays: (days: number) => void;
  addOverride: (override: RetentionOverride) => void;
  removeOverride: (id: string) => void;
  clearCache: (targetId?: string) => void;
  requestStats: () => void;
  init: () => () => void;
}

// =================================================================
// Persistence
// =================================================================

const LS_KEY = 'muster-storage-settings';

function saveSettings(state: { mode: RetentionMode; purgeDays: number; overrides: RetentionOverride[] }): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch { /* quota */ }
}

function loadSettings(): { mode: RetentionMode; purgeDays: number; overrides: RetentionOverride[] } {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { mode: 'keep_all', purgeDays: 30, overrides: [] };
}

// =================================================================
// Store
// =================================================================

export const useStorageStore = create<StorageState>((set, get) => {
  const initial = loadSettings();

  return {
    mode: initial.mode,
    purgeDays: initial.purgeDays,
    overrides: initial.overrides,
    connectedNodeTier: '',
    stats: null,

    setMode: (mode: RetentionMode) => {
      set({ mode });
      saveSettings({ mode, purgeDays: get().purgeDays, overrides: get().overrides });

      // Notify relay of preference change
      const { transport } = useNetworkStore.getState();
      if (transport?.isConnected) {
        transport.send({
          type: 'STORAGE_PREFERENCE',
          payload: { mode, purgeDays: get().purgeDays },
          timestamp: Date.now(),
        });
      }
    },

    setPurgeDays: (days: number) => {
      set({ purgeDays: days });
      saveSettings({ mode: get().mode, purgeDays: days, overrides: get().overrides });
    },

    addOverride: (override: RetentionOverride) => {
      set((s) => {
        const overrides = [...s.overrides.filter((o) => o.id !== override.id), override];
        saveSettings({ mode: s.mode, purgeDays: s.purgeDays, overrides });
        return { overrides };
      });
    },

    removeOverride: (id: string) => {
      set((s) => {
        const overrides = s.overrides.filter((o) => o.id !== id);
        saveSettings({ mode: s.mode, purgeDays: s.purgeDays, overrides });
        return { overrides };
      });
    },

    clearCache: (targetId?: string) => {
      const { transport } = useNetworkStore.getState();
      if (!transport?.isConnected) return;

      if (targetId) {
        // Clear specific community/squad/DM cache
        transport.send({
          type: 'CLEAR_CACHE',
          payload: { targetId },
          timestamp: Date.now(),
        });
      } else {
        // Clear all non-essential cache
        transport.send({
          type: 'CLEAR_CACHE',
          payload: { all: true },
          timestamp: Date.now(),
        });
      }
    },

    requestStats: () => {
      const { transport } = useNetworkStore.getState();
      if (transport?.isConnected) {
        transport.send({
          type: 'GET_STORAGE_STATS',
          payload: {},
          timestamp: Date.now(),
        });
      }
    },

    init: () => {
      const network = useNetworkStore.getState();
      const unsubscribe = network.onMessage((msg) => {
        if (msg.type === 'STORAGE_STATS') {
          const p = msg.payload as any;
          set({
            stats: {
              totalMessages: p.totalMessages || 0,
              totalDMs: p.totalDMs || 0,
              hostedCommunities: p.hostedCommunities || 0,
              cachedCommunities: p.cachedCommunities || 0,
              retentionDays: p.retentionDays || 0,
            },
            connectedNodeTier: p.tier || '',
          });
        }

        if (msg.type === 'NODE_INFO') {
          const p = msg.payload as any;
          if (p.tier) set({ connectedNodeTier: p.tier });
        }
      });

      // Request stats on init
      setTimeout(() => get().requestStats(), 2000);

      return unsubscribe;
    },
  };
});

(window as any).__storage = useStorageStore;
