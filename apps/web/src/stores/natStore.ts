/**
 * NAT Store — R24
 *
 * Detects NAT type and manages relay/proxy settings.
 *
 * NAT types:
 *   open       — direct connections work (port forwarding or public IP)
 *   full_cone  — STUN works, hole punching possible
 *   symmetric  — STUN partially works, needs TURN for voice
 *   restricted — behind strict firewall, all traffic via relay proxy
 *   unknown    — detection not yet run
 *
 * Relay mode:
 *   When a node is behind NAT, it connects outbound to a Main Node.
 *   The Main Node proxies requests to/from the NAT'd node.
 *   All proxied data is E2E encrypted (R22) — proxy is blind.
 */

import { create } from 'zustand';
import { useNetworkStore } from './networkStore';

// =================================================================
// Types
// =================================================================

export type NatType = 'open' | 'full_cone' | 'symmetric' | 'restricted' | 'unknown';

export interface TurnServer {
  urls: string;
  username?: string;
  credential?: string;
}

interface NatState {
  /** Detected NAT type. */
  natType: NatType;
  /** Whether detection is running. */
  detecting: boolean;
  /** Public IP as seen by STUN (if available). */
  publicIp: string;
  /** Local IP. */
  localIp: string;
  /** Whether relay proxy mode is active (node behind NAT). */
  relayProxyActive: boolean;
  /** Main Node acting as proxy (URL). */
  proxyNodeUrl: string;
  /** Custom TURN servers for voice. */
  turnServers: TurnServer[];
  /** Whether port is reachable from outside. */
  portReachable: boolean | null;

  detectNat: () => Promise<void>;
  checkPortReachable: (port: number) => Promise<boolean>;
  addTurnServer: (server: TurnServer) => void;
  removeTurnServer: (urls: string) => void;
  setRelayProxy: (active: boolean, proxyUrl?: string) => void;
  /** Get ICE servers for WebRTC (STUN + configured TURN). */
  getIceServers: () => RTCIceServer[];
  init: () => () => void;
}

// =================================================================
// Persistence
// =================================================================

const LS_KEY = 'muster-nat-config';

function saveConfig(turnServers: TurnServer[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ turnServers })); } catch { /* */ }
}

function loadConfig(): { turnServers: TurnServer[] } {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : { turnServers: [] };
  } catch { return { turnServers: [] }; }
}

// =================================================================
// NAT Detection via WebRTC
// =================================================================

async function detectNatType(): Promise<{ natType: NatType; publicIp: string; localIp: string }> {
  let publicIp = '';
  let localIp = '';
  let natType: NatType = 'unknown';

  try {
    // Create a peer connection with STUN to discover our public IP
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    // Create a data channel to trigger ICE gathering
    pc.createDataChannel('nat-detect');

    const candidates: RTCIceCandidate[] = [];

    const gatherPromise = new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 5000); // 5s timeout

      pc.onicecandidate = (event) => {
        if (!event.candidate) {
          clearTimeout(timeout);
          resolve();
          return;
        }
        candidates.push(event.candidate);
      };
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await gatherPromise;

    // Parse candidates to find IPs
    const srvCandidates = candidates.filter((c) => c.candidate.includes('srflx'));
    const hostCandidates = candidates.filter((c) => c.candidate.includes('host'));

    // Extract local IP from host candidates
    for (const c of hostCandidates) {
      const match = c.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (match && !match[1].startsWith('0.')) {
        localIp = match[1];
        break;
      }
    }

    // Extract public IP from server-reflexive candidates
    const publicIps = new Set<string>();
    for (const c of srvCandidates) {
      const match = c.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (match) publicIps.add(match[1]);
    }

    if (publicIps.size > 0) {
      publicIp = [...publicIps][0]!;
    }

    // Determine NAT type based on candidates
    if (srvCandidates.length === 0 && hostCandidates.length > 0) {
      // No server-reflexive candidates — might be open (no NAT) or restricted
      if (localIp && !localIp.startsWith('10.') && !localIp.startsWith('192.168.') && !localIp.startsWith('172.')) {
        natType = 'open'; // Public IP directly on interface
      } else {
        natType = 'restricted'; // Behind NAT but STUN failed
      }
    } else if (publicIps.size === 1) {
      // Consistent public IP from STUN — either full cone or address-restricted
      natType = 'full_cone';
    } else if (publicIps.size > 1) {
      // Different public IPs from different STUN servers — symmetric NAT
      natType = 'symmetric';
    }

    // If public IP matches local IP, we're open
    if (publicIp && publicIp === localIp) {
      natType = 'open';
    }

    pc.close();
  } catch (err) {
    console.error('[nat] Detection failed:', err);
    natType = 'unknown';
  }

  return { natType, publicIp, localIp };
}

/** Check if a port is reachable from outside by asking the relay to probe. */
async function checkPort(port: number): Promise<boolean> {
  const { transport } = useNetworkStore.getState();
  if (!transport?.isConnected) return false;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 10000);

    const unsub = useNetworkStore.getState().onMessage((msg) => {
      if (msg.type === 'PORT_CHECK_RESULT') {
        clearTimeout(timeout);
        unsub();
        resolve(!!(msg.payload as any)?.reachable);
      }
    });

    transport.send({
      type: 'PORT_CHECK_REQUEST',
      payload: { port },
      timestamp: Date.now(),
    });
  });
}

// =================================================================
// Store
// =================================================================

export const useNatStore = create<NatState>((set, get) => {
  const saved = loadConfig();

  return {
    natType: 'unknown',
    detecting: false,
    publicIp: '',
    localIp: '',
    relayProxyActive: false,
    proxyNodeUrl: '',
    turnServers: saved.turnServers,
    portReachable: null,

    detectNat: async () => {
      set({ detecting: true });
      console.log('[nat] Starting NAT detection...');

      const result = await detectNatType();

      set({
        natType: result.natType,
        publicIp: result.publicIp,
        localIp: result.localIp,
        detecting: false,
      });

      console.log(`[nat] Type: ${result.natType}, Public IP: ${result.publicIp}, Local IP: ${result.localIp}`);

      // Auto-enable relay proxy if behind symmetric/restricted NAT
      if (result.natType === 'symmetric' || result.natType === 'restricted') {
        const connectedUrl = useNetworkStore.getState().connectedNodeUrl;
        set({ relayProxyActive: true, proxyNodeUrl: connectedUrl });
        console.log(`[nat] Auto-enabled relay proxy via ${connectedUrl}`);
      }
    },

    checkPortReachable: async (port: number) => {
      const reachable = await checkPort(port);
      set({ portReachable: reachable });
      return reachable;
    },

    addTurnServer: (server: TurnServer) => {
      set((s) => {
        const turnServers = [...s.turnServers.filter((t) => t.urls !== server.urls), server];
        saveConfig(turnServers);
        return { turnServers };
      });
    },

    removeTurnServer: (urls: string) => {
      set((s) => {
        const turnServers = s.turnServers.filter((t) => t.urls !== urls);
        saveConfig(turnServers);
        return { turnServers };
      });
    },

    setRelayProxy: (active: boolean, proxyUrl?: string) => {
      set({
        relayProxyActive: active,
        proxyNodeUrl: proxyUrl || get().proxyNodeUrl,
      });
    },

    getIceServers: (): RTCIceServer[] => {
      const servers: RTCIceServer[] = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ];

      for (const turn of get().turnServers) {
        const entry: RTCIceServer = { urls: turn.urls };
        if (turn.username) entry.username = turn.username;
        if (turn.credential) entry.credential = turn.credential;
        servers.push(entry);
      }

      return servers;
    },

    init: () => {
      // Auto-detect NAT on first init
      setTimeout(() => {
        if (get().natType === 'unknown') {
          get().detectNat();
        }
      }, 3000);

      const unsub = useNetworkStore.getState().onMessage((msg) => {
        // Handle relay proxy notifications
        if (msg.type === 'RELAY_PROXY_ENABLED') {
          const p = msg.payload as any;
          set({ relayProxyActive: true, proxyNodeUrl: p.proxyUrl || '' });
        }
      });

      return unsub;
    },
  };
});

(window as any).__nat = useNatStore;
