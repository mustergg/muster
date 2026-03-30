/**
 * Network Store — R6 update
 * Changes: Added accountInfo tracking from ACCOUNT_INFO relay messages.
 */

import { create } from 'zustand';
import { WebSocketTransport, TransportMessage } from '@muster/transport';

function sign(message: string, _key: string): string { return 'stub-sig-' + message.slice(0, 8); }

export type ConnectionStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected';

export interface AccountInfo {
  publicKey: string;
  username: string;
  tier: 'basic' | 'verified';
  emailVerified: boolean;
  createdAt: number;
  daysRemaining: number;
}

interface NetworkState {
  status: ConnectionStatus;
  transport: WebSocketTransport | null;
  publicKey: string;
  username: string;
  error: string | null;
  peerCount: number;
  peerId: string;
  /** Account info received from relay after auth. */
  accountInfo: AccountInfo | null;

  connect: () => Promise<void>;
  disconnect: () => void;
  onMessage: (handler: (msg: TransportMessage) => void) => () => void;
}

const DEFAULT_RELAY_URL =
  import.meta?.env?.VITE_RELAY_URL || 'ws://192.168.1.73:4002';

export const useNetworkStore = create<NetworkState>((set, get) => {
  const messageHandlers = new Set<(msg: TransportMessage) => void>();

  return {
    status: 'disconnected',
    transport: null,
    publicKey: '',
    username: '',
    error: null,
    peerCount: 0,
    peerId: '',
    accountInfo: null,

    connect: async () => {
      const auth = (await import('./authStore.js')).useAuthStore.getState();
      const publicKey = auth.publicKeyHex || '';
      const username = auth.username || '';
      const url = DEFAULT_RELAY_URL;

      if (get().status !== 'disconnected') return;

      const transport = new WebSocketTransport({ reconnectBaseDelay: 2000, reconnectMaxDelay: 30000 });
      set({ transport, status: 'connecting', error: null, publicKey, username, peerId: publicKey });

      transport.on('message', (msg) => {
        if (msg.type === 'AUTH_CHALLENGE') {
          set({ status: 'authenticating' });
          const challenge = (msg.payload as any).challenge as string;
          const signature = sign(challenge, publicKey);
          transport.send({ type: 'AUTH_RESPONSE', payload: { publicKey, signature, username }, timestamp: Date.now() });
          return;
        }

        if (msg.type === 'AUTH_RESULT') {
          const result = msg.payload as any;
          if (result.success) {
            console.log('[network] Authenticated successfully');
            set({ status: 'connected', error: null, peerCount: 1 });
          } else {
            set({ status: 'disconnected', error: result.reason || 'Authentication failed' });
          }
          return;
        }

        // Capture account info from relay
        if (msg.type === 'ACCOUNT_INFO') {
          const info = msg.payload as any;
          set({ accountInfo: info as AccountInfo });
          console.log(`[network] Account: tier=${info.tier}, days=${info.daysRemaining}`);
          return;
        }

        if (msg.type === 'EMAIL_VERIFIED') {
          const p = msg.payload as any;
          if (p.success) {
            // Update account info immediately
            set((state) => ({
              accountInfo: state.accountInfo
                ? { ...state.accountInfo, tier: 'verified', emailVerified: true, daysRemaining: 0 }
                : null,
            }));
          }
        }

        if (msg.type === 'PRESENCE') {
          const users = (msg.payload as any).users || [];
          set({ peerCount: users.length });
        }

        for (const handler of messageHandlers) handler(msg);
      });

      transport.on('connected', () => { console.log('[network] WebSocket connected, waiting for auth...'); });
      transport.on('disconnected', (reason) => { set({ status: 'disconnected', peerCount: 0 }); });
      transport.on('error', (err) => { set({ error: err.message }); });

      try { await transport.connect(url); }
      catch (err) {
        set({ status: 'disconnected', error: err instanceof Error ? err.message : 'Connection failed', transport: null });
      }
    },

    disconnect: () => {
      get().transport?.disconnect();
      set({ status: 'disconnected', transport: null, error: null, peerCount: 0, accountInfo: null });
    },

    onMessage: (handler) => {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
  };
});

(window as any).__network = useNetworkStore;
