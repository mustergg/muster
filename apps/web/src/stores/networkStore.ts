/**
 * Network Store — R20
 *
 * Changes from R11-QOL2:
 * - Uses nodeDiscovery for connection fallback
 * - Tries nodes in priority order (last connected → stable → seeds → manual)
 * - Auto-reconnect to next node if current fails
 * - Receives NODE_INFO from relay (uptime, version) and updates discovery
 * - Receives PEX peer list and feeds discovered nodes to nodeDiscovery
 */

import { create } from 'zustand';
import { WebSocketTransport, TransportMessage } from '@muster/transport';
import { sign as ed25519Sign, toHex, fromHex } from '@muster/crypto';
import { useNodeDiscovery } from './nodeDiscovery';

const encoder = new TextEncoder();

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
  /** URL of the currently connected relay. */
  connectedNodeUrl: string;
  /** Whether we're cycling through fallback nodes. */
  fallbackActive: boolean;

  connect: () => Promise<void>;
  disconnect: () => void;
  onMessage: (handler: (msg: TransportMessage) => void) => () => void;
}

/** Maximum number of nodes to try before giving up. */
const MAX_FALLBACK_ATTEMPTS = 10;

/** Delay between fallback attempts (ms). */
const FALLBACK_DELAY = 2000;

export const useNetworkStore = create<NetworkState>((set, get) => {
  const messageHandlers = new Set<(msg: TransportMessage) => void>();
  let fallbackTimeout: ReturnType<typeof setTimeout> | null = null;
  let intentionalDisconnect = false;
  let connectionGen = 0; // bump on every new connection attempt

  /** Try connecting to the next available node. */
  async function tryNextNode(): Promise<void> {
    const discovery = useNodeDiscovery.getState();
    const url = discovery.getNextNode();

    if (!url) {
      // All nodes exhausted
      set({ status: 'disconnected', error: 'All nodes unreachable. Add a node in Settings or try again later.', fallbackActive: false });
      discovery.resetTryIndex();
      return;
    }

    console.log(`[network] Trying node: ${url}`);
    await connectToUrl(url);
  }

  /** Connect to a specific relay URL. */
  async function connectToUrl(url: string): Promise<void> {
    const myGen = ++connectionGen;
    if (fallbackTimeout) { clearTimeout(fallbackTimeout); fallbackTimeout = null; }
    const auth = (await import('./authStore.js')).useAuthStore.getState();
    const publicKey = auth.publicKeyHex || '';
    const username = auth.username || '';
    const keypair = auth._keypair;
    const authMode = auth._authMode || 'login';

    if (!keypair) {
      set({ error: 'No keypair available — please log in again' });
      return;
    }

    // Clean up existing transport
    const existing = get().transport;
    if (existing) {
      try { existing.disconnect(); } catch { /* ignore */ }
    }

    const transport = new WebSocketTransport({ reconnectBaseDelay: 100, reconnectMaxDelay: 200, maxReconnectAttempts: 10, autoReconnect: false });
    set({ transport, status: 'connecting', error: null, publicKey, username, peerId: publicKey, connectedNodeUrl: url });

    transport.on('message', (msg) => {
      if (msg.type === 'AUTH_CHALLENGE') {
        set({ status: 'authenticating' });
        const challenge = (msg.payload as any).challenge as string;

        signMessage(challenge, keypair.privateKey).then((signature) => {
          transport.send({
            type: 'AUTH_RESPONSE',
            payload: { publicKey, signature, username, authMode },
            timestamp: Date.now(),
          });
          console.log(`[network] Auth challenge signed with Ed25519 (mode: ${authMode})`);
        }).catch((err) => {
          console.error('[network] Failed to sign challenge:', err);
          set({ status: 'disconnected', error: 'Signing failed' });
        });
        return;
      }

      if (msg.type === 'AUTH_RESULT') {
        const result = msg.payload as any;
        if (result.success) {
          console.log(`[network] Authenticated to ${url}`);
          set({ status: 'connected', error: null, peerCount: 1, fallbackActive: false });

          // Mark this node as successfully connected
          useNodeDiscovery.getState().markSuccess(url);

          // Save pending keystore
          import('./authStore.js').then(({ useAuthStore }) => {
            useAuthStore.getState().confirmAuth();
          });

          // Request node info for discovery ranking
          transport.send({ type: 'GET_NODE_INFO', payload: {}, timestamp: Date.now() });
        } else {
          console.error('[network] Auth failed:', result.reason);
          set({ status: 'disconnected', error: result.reason || 'Authentication failed' });
          transport.disconnect();
          import('./authStore.js').then(({ useAuthStore }) => {
            useAuthStore.getState().handleAuthFailure();
          });
        }
        return;
      }

      if (msg.type === 'ACCOUNT_INFO') {
        const info = msg.payload as any;
        set({ accountInfo: info as AccountInfo });
        console.log(`[network] Account: tier=${info.tier}, days=${info.daysRemaining}`);
        return;
      }

      // R20: Handle NODE_INFO response — update discovery with uptime/version
      if (msg.type === 'NODE_INFO') {
        const info = msg.payload as any;
        const currentUrl = get().connectedNodeUrl;
        if (currentUrl && info) {
          useNodeDiscovery.getState().updateNodeInfo(currentUrl, {
            uptimePercent: info.uptimePercent,
            activeDays: info.activeDays,
            name: info.nodeName,
          });
          console.log(`[network] Node info: ${info.nodeName} (uptime ${info.uptimePercent}%, ${info.activeDays}d)`);
        }
        return;
      }

      // R20: Handle peer list from relay — feed discovered nodes
      if (msg.type === 'NODE_PEERS') {
        const peers = (msg.payload as any)?.peers;
        if (Array.isArray(peers) && peers.length > 0) {
          useNodeDiscovery.getState().addDiscoveredNodes(
            peers.map((p: any) => ({
              url: p.url,
              name: p.name || '',
              uptimePercent: p.uptimePercent || 0,
              activeDays: p.activeDays || 0,
            }))
          );
          console.log(`[network] Discovered ${peers.length} peer nodes`);
        }
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

    transport.on('connected', () => {
      console.log(`[network] WebSocket connected to ${url}, waiting for auth...`);
    });

    transport.on('disconnected', (reason) => {
      set({ status: 'disconnected', peerCount: 0 });

      // If not intentional, try fallback to next node
      if (!intentionalDisconnect && get().connectedNodeUrl) {
        console.log(`[network] Disconnected from ${url}. Trying next node...`);
        useNodeDiscovery.getState().markFail(url);

        if (fallbackTimeout) clearTimeout(fallbackTimeout);
        fallbackTimeout = setTimeout(() => {
          if (myGen !== connectionGen) return;
          set({ fallbackActive: true });
          tryNextNode();
        }, FALLBACK_DELAY);
      }
    });

    transport.on('error', (err) => {
      set({ error: err.message });
    });

    try {
      await transport.connect(url);
    } catch (err) {
      console.warn(`[network] Failed to connect to ${url}:`, err);
      useNodeDiscovery.getState().markFail(url);

      // Try next node
      if (!intentionalDisconnect) {
        if (fallbackTimeout) clearTimeout(fallbackTimeout);
        fallbackTimeout = setTimeout(() => {
          if (myGen !== connectionGen) return;
          set({ fallbackActive: true });
          tryNextNode();
        }, FALLBACK_DELAY);
      } else {
        set({ status: 'disconnected', error: err instanceof Error ? err.message : 'Connection failed', transport: null });
      }
    }
  }

  return {
    status: 'disconnected',
    transport: null,
    publicKey: '',
    username: '',
    error: null,
    peerCount: 0,
    peerId: '',
    accountInfo: null,
    connectedNodeUrl: '',
    fallbackActive: false,

    connect: async () => {
      if (get().status !== 'disconnected') return;
      intentionalDisconnect = false;

      // Reset discovery index and start trying nodes
      useNodeDiscovery.getState().resetTryIndex();
      await tryNextNode();
    },

    disconnect: () => {
      intentionalDisconnect = true;
      if (fallbackTimeout) { clearTimeout(fallbackTimeout); fallbackTimeout = null; }
      get().transport?.disconnect();
      useNodeDiscovery.getState().setCurrentNode(null);
      set({ status: 'disconnected', transport: null, error: null, peerCount: 0, accountInfo: null, connectedNodeUrl: '', fallbackActive: false });
    },

    onMessage: (handler) => {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
  };
});

(window as any).__network = useNetworkStore;
