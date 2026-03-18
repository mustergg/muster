/**
 * Network store — manages the libp2p node lifecycle and connection state.
 */

import { create } from 'zustand';
import { createMusterNode, type MusterNode } from '@muster/core';

export type NetworkStatus = 'disconnected' | 'connecting' | 'connected';

interface NetworkState {
  status: NetworkStatus;
  node: MusterNode | null;
  peerCount: number;
  peerId: string | null;
  latencyMs: number | null;

  /** Start the libp2p node and connect to the network */
  connect: () => Promise<void>;

  /** Stop the libp2p node cleanly */
  disconnect: () => Promise<void>;
}

export const useNetworkStore = create<NetworkState>()((set, get) => ({
  status:    'disconnected',
  node:      null,
  peerCount: 0,
  peerId:    null,
  latencyMs: null,

  connect: async () => {
    if (get().status !== 'disconnected') return;
    set({ status: 'connecting' });

    try {
      const node = await createMusterNode({
        gossipD: 6,
      });

      // Track peer count
      node.addEventListener('peer:connect', () => {
        set({ peerCount: node.getPeers().length });
      });
      node.addEventListener('peer:disconnect', () => {
        set({ peerCount: node.getPeers().length });
      });

      set({
        status:    'connected',
        node,
        peerId:    node.peerId.toString(),
        peerCount: node.getPeers().length,
      });
    } catch (err) {
      console.error('[Network] Failed to start node:', err);
      set({ status: 'disconnected' });
      throw err;
    }
  },

  disconnect: async () => {
    const { node } = get();
    if (node) {
      await node.stop();
    }
    set({ status: 'disconnected', node: null, peerCount: 0, peerId: null });
  },
}));
