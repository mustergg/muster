/**
 * Node Discovery — R20
 *
 * Manages the list of known relay nodes with connection fallback.
 *
 * Priority order:
 *   1. Last successfully connected node
 *   2. Nodes ranked by stability (uptime % × days active)
 *   3. Seed nodes (hardcoded bootstrap list)
 *   4. Manually added nodes
 *
 * After connecting, the client receives peer info via PEX and
 * stores the top 10 most stable nodes locally.
 */

import { create } from 'zustand';

// =================================================================
// Types
// =================================================================

export interface KnownNode {
  url: string;
  name: string;
  region: string;
  /** Reported uptime percentage (0-100). From relay NODE_INFO. */
  uptimePercent: number;
  /** How many days this node has been active. From relay NODE_INFO. */
  activeDays: number;
  /** Stability score = uptimePercent × log2(activeDays + 1). Higher = better. */
  stabilityScore: number;
  /** Last successful connection timestamp. */
  lastConnected: number;
  /** Number of successful connections. */
  connectCount: number;
  /** Number of failed connection attempts. */
  failCount: number;
  /** Was this manually added by the user? */
  manual: boolean;
  /** Is this a seed node? */
  seed: boolean;
}

interface NodeDiscoveryState {
  /** All known nodes, sorted by priority. */
  nodes: KnownNode[];
  /** Currently connected node URL (null if disconnected). */
  currentNodeUrl: string | null;
  /** Index of the node we're currently trying. */
  tryIndex: number;
  /** Whether we're in fallback mode (trying nodes one by one). */
  falling: boolean;

  /** Get the next node URL to try. Returns null if all exhausted. */
  getNextNode: () => string | null;
  /** Reset try index (start over from top priority). */
  resetTryIndex: () => void;
  /** Mark a node as successfully connected. */
  markSuccess: (url: string) => void;
  /** Mark a node as failed. */
  markFail: (url: string) => void;
  /** Add node info received from relay (PEX peers). */
  addDiscoveredNodes: (nodes: Array<{ url: string; name: string; uptimePercent?: number; activeDays?: number }>) => void;
  /** Manually add a node. */
  addManualNode: (url: string, name?: string) => void;
  /** Remove a node. */
  removeNode: (url: string) => void;
  /** Update node info from relay's NODE_INFO response. */
  updateNodeInfo: (url: string, info: { uptimePercent?: number; activeDays?: number; name?: string }) => void;
  /** Get sorted node list for display. */
  getSortedNodes: () => KnownNode[];
  /** Set the current node. */
  setCurrentNode: (url: string | null) => void;
}

// =================================================================
// Persistence
// =================================================================

const LS_KEY = 'muster-known-nodes';
const MAX_STORED_NODES = 10;

function saveNodes(nodes: KnownNode[]): void {
  try {
    // Save top N non-seed nodes + all manual nodes
    const toSave = nodes
      .filter((n) => !n.seed || n.manual)
      .slice(0, MAX_STORED_NODES);
    localStorage.setItem(LS_KEY, JSON.stringify(toSave));
  } catch { /* quota */ }
}

function loadNodes(): KnownNode[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// =================================================================
// Seed nodes (embedded at build time, also loadable from repo)
// =================================================================

const SEED_NODES: KnownNode[] = [
  {
    url: 'ws://musternode.duckdns.org:4002',
    name: 'Muster Main Node',
    region: 'EU-PT',
    uptimePercent: 0,
    activeDays: 0,
    stabilityScore: 0,
    lastConnected: 0,
    connectCount: 0,
    failCount: 0,
    manual: false,
    seed: true,
  },
  {
    url: 'ws://192.168.1.73:4002',
    name: 'Local Dev',
    region: 'EU-PT',
    uptimePercent: 0, activeDays: 0, stabilityScore: 0,
    lastConnected: 0, connectCount: 0, failCount: 0,
    manual: false, seed: true,
  },
];

// =================================================================
// Helpers
// =================================================================

function calcStability(uptimePercent: number, activeDays: number): number {
  return uptimePercent * Math.log2(activeDays + 1);
}

function mergeNodes(existing: KnownNode[], incoming: KnownNode[]): KnownNode[] {
  const map = new Map<string, KnownNode>();
  // Existing nodes first (preserve stats)
  for (const n of existing) map.set(n.url, n);
  // Incoming nodes — only add if new, don't overwrite stats
  for (const n of incoming) {
    if (!map.has(n.url)) {
      map.set(n.url, n);
    }
  }
  return Array.from(map.values());
}

function sortNodes(nodes: KnownNode[]): KnownNode[] {
  return [...nodes].sort((a, b) => {
    // 1. Last connected (most recent first)
    if (a.lastConnected !== b.lastConnected) return b.lastConnected - a.lastConnected;
    // 2. Stability score (higher first)
    if (a.stabilityScore !== b.stabilityScore) return b.stabilityScore - a.stabilityScore;
    // 3. Connect count (more = more reliable)
    if (a.connectCount !== b.connectCount) return b.connectCount - a.connectCount;
    // 4. Seeds last
    if (a.seed !== b.seed) return a.seed ? 1 : -1;
    return 0;
  });
}

// =================================================================
// Store
// =================================================================

export const useNodeDiscovery = create<NodeDiscoveryState>((set, get) => {
  // Initialize: merge saved nodes with seed nodes
  const saved = loadNodes();
  const initial = sortNodes(mergeNodes(saved, SEED_NODES));

  return {
    nodes: initial,
    currentNodeUrl: null,
    tryIndex: 0,
    falling: false,

    getNextNode: () => {
      const { nodes, tryIndex } = get();
      if (tryIndex >= nodes.length) return null;
      const node = nodes[tryIndex];
      set({ tryIndex: tryIndex + 1, falling: tryIndex > 0 });
      return node?.url || null;
    },

    resetTryIndex: () => set({ tryIndex: 0, falling: false }),

    markSuccess: (url: string) => {
      set((state) => {
        const nodes = state.nodes.map((n) =>
          n.url === url
            ? { ...n, lastConnected: Date.now(), connectCount: n.connectCount + 1, failCount: 0 }
            : n
        );
        const sorted = sortNodes(nodes);
        saveNodes(sorted);
        return { nodes: sorted, currentNodeUrl: url, falling: false, tryIndex: 0 };
      });
    },

    markFail: (url: string) => {
      set((state) => {
        const nodes = state.nodes.map((n) =>
          n.url === url ? { ...n, failCount: n.failCount + 1 } : n
        );
        saveNodes(nodes);
        return { nodes };
      });
    },

    addDiscoveredNodes: (incoming) => {
      set((state) => {
        const newNodes: KnownNode[] = incoming.map((n) => ({
          url: n.url,
          name: n.name || '',
          region: '',
          uptimePercent: n.uptimePercent || 0,
          activeDays: n.activeDays || 0,
          stabilityScore: calcStability(n.uptimePercent || 0, n.activeDays || 0),
          lastConnected: 0,
          connectCount: 0,
          failCount: 0,
          manual: false,
          seed: false,
        }));
        const merged = mergeNodes(state.nodes, newNodes);
        const sorted = sortNodes(merged);
        saveNodes(sorted);
        return { nodes: sorted };
      });
    },

    addManualNode: (url: string, name?: string) => {
      // Normalize URL
      let normalized = url.trim();
      if (!normalized.startsWith('ws://') && !normalized.startsWith('wss://')) {
        normalized = 'ws://' + normalized;
      }

      set((state) => {
        // Don't add duplicates
        if (state.nodes.some((n) => n.url === normalized)) return state;

        const newNode: KnownNode = {
          url: normalized,
          name: name || normalized,
          region: '',
          uptimePercent: 0,
          activeDays: 0,
          stabilityScore: 0,
          lastConnected: 0,
          connectCount: 0,
          failCount: 0,
          manual: true,
          seed: false,
        };
        const nodes = sortNodes([...state.nodes, newNode]);
        saveNodes(nodes);
        return { nodes };
      });
    },

    removeNode: (url: string) => {
      set((state) => {
        const nodes = state.nodes.filter((n) => n.url !== url);
        saveNodes(nodes);
        return { nodes };
      });
    },

    updateNodeInfo: (url, info) => {
      set((state) => {
        const nodes = state.nodes.map((n) => {
          if (n.url !== url) return n;
          const uptimePercent = info.uptimePercent ?? n.uptimePercent;
          const activeDays = info.activeDays ?? n.activeDays;
          return {
            ...n,
            name: info.name || n.name,
            uptimePercent,
            activeDays,
            stabilityScore: calcStability(uptimePercent, activeDays),
          };
        });
        const sorted = sortNodes(nodes);
        saveNodes(sorted);
        return { nodes: sorted };
      });
    },

    getSortedNodes: () => sortNodes(get().nodes),

    setCurrentNode: (url) => set({ currentNodeUrl: url }),
  };
});

(window as any).__nodes = useNodeDiscovery;
