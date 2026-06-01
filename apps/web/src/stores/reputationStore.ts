/**
 * Reputation Store — R25 / Phase 7.
 *
 * On-demand view of the connected relay's local peer-reputation table
 * (REPUTATION_STATS_REQUEST → REPUTATION_STATS). Reputation is local to each
 * node and never gossiped (POS.md §Reputation); this is purely an operator
 * debug surface.
 */

import { create } from 'zustand';
import { useNetworkStore } from './networkStore';
import type { TransportMessage } from '@muster/transport';

export interface ReputationStats {
  tracked: number;
  preferred: number;
  deprioritised: number;
  blacklisted: number;
  totalChallengesIssued: number;
  totalChallengesPassed: number;
  totalChallengesFailed: number;
  totalChallengesTimedOut: number;
}

export interface ReputationPeer {
  peerId: string;
  score: number;
  blacklistedUntil: number | null;
}

interface ReputationState {
  stats: ReputationStats | null;
  peers: ReputationPeer[];
  updatedAt: number;
  init: () => () => void;
  requestNow: () => void;
}

export const useReputationStore = create<ReputationState>((set) => ({
  stats: null,
  peers: [],
  updatedAt: 0,

  requestNow: () => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'REPUTATION_STATS_REQUEST', payload: {}, timestamp: Date.now() });
  },

  init: () => {
    const network = useNetworkStore.getState();
    const unsub = network.onMessage((msg: TransportMessage) => {
      if (msg.type !== 'REPUTATION_STATS') return;
      const p = msg.payload as { stats?: ReputationStats; peers?: ReputationPeer[] } | undefined;
      if (!p) return;
      set({ stats: p.stats ?? null, peers: p.peers ?? [], updatedAt: Date.now() });
    });
    return unsub;
  },
}));

(window as any).__reputation = useReputationStore;
