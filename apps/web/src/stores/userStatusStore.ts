/**
 * userStatusStore — presence of arbitrary users (DM partners) the client
 * subscribes to, even without a shared channel. Backed by the relay's
 * SUBSCRIBE_USER_STATUS → USER_STATUS / USER_STATUS_BULK.
 */
import { create } from 'zustand';
import { useNetworkStore } from './networkStore';

interface UserStatusState {
  statuses: Record<string, string>; // publicKey → 'online' | 'idle' | 'dnd' | 'offline'
  subscribe: (keys: string[]) => void;
  init: () => () => void;
}

export const useUserStatus = create<UserStatusState>((set) => ({
  statuses: {},

  subscribe: (keys) => {
    const net = useNetworkStore.getState();
    if (keys.length && net.transport?.isConnected) {
      net.transport.send({ type: 'SUBSCRIBE_USER_STATUS', payload: { keys }, timestamp: Date.now() });
    }
  },

  init: () => {
    const net = useNetworkStore.getState();
    const unsub = net.onMessage((msg) => {
      if (msg.type === 'USER_STATUS') {
        const p = msg.payload as any;
        set((s) => ({ statuses: { ...s.statuses, [p.publicKey]: p.status } }));
      } else if (msg.type === 'USER_STATUS_BULK') {
        const arr = ((msg.payload as any)?.statuses || []) as Array<{ publicKey: string; status: string }>;
        set((s) => { const next = { ...s.statuses }; for (const it of arr) next[it.publicKey] = it.status; return { statuses: next }; });
      }
    });
    return unsub;
  },
}));
