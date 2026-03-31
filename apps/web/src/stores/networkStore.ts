/**
 * Network Store — Real Crypto Integration
 *
 * Changes: Replaced stub sign() with real Ed25519 signing from @muster/crypto.
 * The auth challenge is now signed with the user's actual private key.
 */

import { create } from 'zustand';
import { WebSocketTransport, TransportMessage } from '@muster/transport';
import { sign as ed25519Sign, toHex, fromHex } from '@muster/crypto';

const encoder = new TextEncoder();

/**
 * Sign a string message with the user's Ed25519 private key.
 * Returns a hex-encoded signature string.
 */
async function signMessage(message: string, privateKey: Uint8Array): Promise<string> {
  const msgBytes = encoder.encode(message);
  const sigBytes = await ed25519Sign(msgBytes, privateKey);
  return toHex(sigBytes);
}

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
      const keypair = auth._keypair; // Real Ed25519 keypair
      const url = DEFAULT_RELAY_URL;

      if (get().status !== 'disconnected') return;

      if (!keypair) {
        set({ error: 'No keypair available — please log in again' });
        return;
      }

      const transport = new WebSocketTransport({ reconnectBaseDelay: 2000, reconnectMaxDelay: 30000 });
      set({ transport, status: 'connecting', error: null, publicKey, username, peerId: publicKey });

      transport.on('message', (msg) => {
        if (msg.type === 'AUTH_CHALLENGE') {
          set({ status: 'authenticating' });
          const challenge = (msg.payload as any).challenge as string;

          // Real Ed25519 signature of the challenge
          signMessage(challenge, keypair.privateKey).then((signature) => {
            transport.send({
              type: 'AUTH_RESPONSE',
              payload: { publicKey, signature, username },
              timestamp: Date.now(),
            });
            console.log('[network] Auth challenge signed with Ed25519');
          }).catch((err) => {
            console.error('[network] Failed to sign challenge:', err);
            set({ status: 'disconnected', error: 'Signing failed' });
          });
          return;
        }

        if (msg.type === 'AUTH_RESULT') {
          const result = msg.payload as any;
          if (result.success) {
            console.log('[network] Authenticated successfully (Ed25519 verified)');
            set({ status: 'connected', error: null, peerCount: 1 });
          } else {
            console.error('[network] Auth failed:', result.reason);
            set({ status: 'disconnected', error: result.reason || 'Authentication failed' });
          }
          return;
        }

        if (msg.type === 'ACCOUNT_INFO') {
          const info = msg.payload as any;
          set({ accountInfo: info as AccountInfo });
          console.log(`[network] Account: tier=${info.tier}, days=${info.daysRemaining}`);
          return;
        }

        if (msg.type === 'EMAIL_VERIFIED') {
          const p = msg.payload as any;
          if (p.success) {
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
