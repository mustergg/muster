/**
 * Network store — manages the libp2p node lifecycle.
 * Now also triggers DB initialisation after connecting.
 */

import { create } from 'zustand';
import { createMusterNode, type MusterNode } from '@muster/core';
import { useDBStore } from './dbStore.js';

export type NetworkStatus = 'disconnected' | 'connecting' | 'connected';

interface NetworkState {
  status:    NetworkStatus;
  node:      MusterNode | null;
  peerCount: number;
  peerId:    string | null;

  connect:    () => Promise<void>;
  disconnect: () => Promise<void>;
}

export const useNetworkStore = create<NetworkState>()((set, get) => ({
  status:    'disconnected',
  node:      null,
  peerCount: 0,
  peerId:    null,

 connect: async () => {
  if (get().status !== 'disconnected') return;
  console.log('[Network] Connecting...');
  set({ status: 'connecting' });
  try {
    console.log('[Network] Creating libp2p node...');
    const node = await createMusterNode({ gossipD: 6 });
    console.log('[Network] Node created! Peer ID:', node.peerId.toString());
    node.addEventListener('peer:connect',    () => {
      console.log('[Network] Peer connected! Total:', node.getPeers().length);
      set({ peerCount: node.getPeers().length });
    });
    node.addEventListener('peer:disconnect', () => set({ peerCount: node.getPeers().length }));
    set({ status: 'connected', node, peerId: node.peerId.toString(), peerCount: node.getPeers().length });
    useDBStore.getState().initDB().catch((err) => {
      console.warn('[Network] DB init failed (non-fatal):', err);
    });
  } catch (err) {
    console.error('[Network] Failed to start node:', err);
    set({ status: 'disconnected' });
    throw err;
  }
},

  disconnect: async () => {
    await useDBStore.getState().closeDB();
    const { node } = get();
    if (node) await node.stop();
    set({ status: 'disconnected', node: null, peerCount: 0, peerId: null });
  },
}));
