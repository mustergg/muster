/**
 * Network Store — manages the WebSocket connection to the relay node.
 *
 * REPLACES the old networkStore.ts (which used libp2p/GossipSub).
 * This version uses @muster/transport (pure WebSocket, zero native deps).
 *
 * How it works:
 * 1. Client connects to relay via WebSocket
 * 2. Relay sends AUTH_CHALLENGE (random 32-byte hex)
 * 3. Client signs challenge with Ed25519 private key
 * 4. Relay verifies → AUTH_RESULT (success/fail)
 * 5. Client is now authenticated and can subscribe/publish
 */

import { create } from 'zustand';
import { WebSocketTransport, TransportMessage } from '@muster/transport';

// -----------------------------------------------------------------
// NOTE: Adjust these imports to match your @muster/crypto package.
// You need a function that signs a string with an Ed25519 private key.
// -----------------------------------------------------------------
// import { sign } from '@muster/crypto';

// TEMPORARY stub for initial testing — replace with real crypto
function sign(message: string, _privateKey: string): string {
  console.warn('[network] WARNING: Using stub signing — replace with @muster/crypto');
  return 'stub-signature-' + message.slice(0, 8);
}

// =================================================================
// Types
// =================================================================

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected';

interface NetworkState {
  /** Current connection status. */
  status: ConnectionStatus;

  /** The transport instance (null if not connected). */
  transport: WebSocketTransport | null;

  /** The authenticated user's public key. */
  publicKey: string;

  /** The authenticated user's username. */
  username: string;

  /** Error message if connection failed. */
  error: string | null;

  /** Connect to a relay node. */
  connect: () => Promise<void>;

  /** Disconnect from the relay node. */
  disconnect: () => void;

  /**
   * Register a handler for incoming relay messages.
   * Returns an unsubscribe function.
   */
  onMessage: (handler: (msg: TransportMessage) => void) => () => void;
}

// =================================================================
// Default relay URL
// =================================================================

// UPDATE THIS to your relay node's address (DuckDNS domain + port).
// During local development, use ws://localhost:4002
const DEFAULT_RELAY_URL =
  import.meta?.env?.VITE_RELAY_URL || 'ws://musternode.duckdns.org:4002';
  //import.meta?.env?.VITE_RELAY_URL || 'ws://localhost:4002';

// =================================================================
// Store
// =================================================================

export const useNetworkStore = create<NetworkState>((set, get) => {
  const messageHandlers = new Set<(msg: TransportMessage) => void>();

  return {
    status: 'disconnected',
    transport: null,
    publicKey: '',
    username: '',
    error: null,

    connect: async () => {
      const auth = (await import('./authStore.js')).useAuthStore.getState();
      const publicKey = auth.publicKeyHex || '';
      const username = auth.username || '';
      const url = DEFAULT_RELAY_URL;
      console.log('[network] DEBUG url:', url, 'status:', get().status);

      // Don't connect twice
      if (get().status !== 'disconnected') {
        console.warn('[network] Already connecting or connected');
        return;
      }

      const transport = new WebSocketTransport({
        reconnectBaseDelay: 2000,
        reconnectMaxDelay: 30000,
      });

      set({
        transport,
        status: 'connecting',
        error: null,
        publicKey,
        username,
      });

      // Handle incoming messages
      transport.on('message', (msg) => {
        // Handle auth flow internally
        if (msg.type === 'AUTH_CHALLENGE') {
          set({ status: 'authenticating' });
          const challenge = (msg.payload as any).challenge as string;
          // TODO: Replace stub with real @muster/crypto signing using auth._keypair.privateKey
          const signature = sign(challenge, publicKey);

          transport.send({
            type: 'AUTH_RESPONSE',
            payload: { publicKey, signature, username },
            timestamp: Date.now(),
          });
          return;
        }

        if (msg.type === 'AUTH_RESULT') {
          const result = msg.payload as any;
          if (result.success) {
            console.log('[network] Authenticated successfully');
            set({ status: 'connected', error: null });
          } else {
            console.error('[network] Auth failed:', result.reason);
            set({
              status: 'disconnected',
              error: result.reason || 'Authentication failed',
            });
          }
          return;
        }

        // Forward all other messages to registered handlers
        for (const handler of messageHandlers) {
          handler(msg);
        }
      });

      transport.on('connected', () => {
        console.log('[network] WebSocket connected, waiting for auth...');
        // Don't set 'connected' here — wait for AUTH_RESULT
      });

      transport.on('disconnected', (reason) => {
        console.log('[network] Disconnected:', reason);
        set({ status: 'disconnected' });
      });

      transport.on('error', (err) => {
        console.error('[network] Transport error:', err.message);
        set({ error: err.message });
      });

      // Attempt connection
      try {
        await transport.connect(url);
      } catch (err) {
        set({
          status: 'disconnected',
          error: err instanceof Error ? err.message : 'Connection failed',
          transport: null,
        });
      }
    },

    disconnect: () => {
      get().transport?.disconnect();
      set({
        status: 'disconnected',
        transport: null,
        error: null,
      });
    },

    onMessage: (handler) => {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
  };
});

// TEMPORARY: expose store for R1 testing — remove after R3
(window as any).__network = useNetworkStore;