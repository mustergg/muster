/**
 * Client Node Store — R23 fix v2
 *
 * Fixed: Uses bundled relay (relay.js) from Tauri resources.
 * The relay is bundled as a single file via esbuild with native
 * modules (better-sqlite3) copied alongside.
 */

import { create } from 'zustand';

// =================================================================
// Types
// =================================================================

export type NodeMode = 'off' | 'temp' | 'client';

export interface ClientNodeConfig {
  mode: NodeMode;
  port: number;
  maxDiskMB: number;
  maxBandwidthMBPerDay: number;
  hostedCommunityIds: string[];
  autoStart: boolean;
  relayPath: string;
}

interface ClientNodeState {
  config: ClientNodeConfig;
  running: boolean;
  pid: number | null;
  logs: string[];
  error: string;
  uptimeSeconds: number;
  resolvedRelayPath: string;

  start: () => Promise<void>;
  stop: () => Promise<void>;
  setMode: (mode: NodeMode) => void;
  setPort: (port: number) => void;
  setMaxDisk: (mb: number) => void;
  setMaxBandwidth: (mb: number) => void;
  setAutoStart: (auto: boolean) => void;
  setRelayPath: (path: string) => void;
  hostCommunity: (id: string) => void;
  unhostCommunity: (id: string) => void;
  clearLogs: () => void;
}

// =================================================================
// Persistence
// =================================================================

const LS_KEY = 'muster-client-node-config';

const DEFAULT_CONFIG: ClientNodeConfig = {
  mode: 'off',
  port: 4003,
  maxDiskMB: 2048,
  maxBandwidthMBPerDay: 512,
  hostedCommunityIds: [],
  autoStart: false,
  relayPath: '',
};

function saveConfig(config: ClientNodeConfig): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(config)); } catch { /* */ }
}

function loadConfig(): ClientNodeConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : DEFAULT_CONFIG;
  } catch { return DEFAULT_CONFIG; }
}

// =================================================================
// Tauri helpers
// =================================================================

let childProcess: any = null;
let startTime = 0;
let uptimeInterval: ReturnType<typeof setInterval> | null = null;

async function isTauri(): Promise<boolean> {
  return typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
}

/**
 * Resolve the relay entry point. Priority:
 *   1. Manual path from config
 *   2. Tauri bundled resource: relay/relay.js (standalone bundle)
 *   3. Dev monorepo: apps/relay/dist/index.js
 */
async function resolveRelayPath(manualPath: string): Promise<string> {
  if (manualPath) return manualPath;

  if (await isTauri()) {
    try {
      // @ts-ignore
      const { resolveResource } = await import('@tauri-apps/api/path');
      const resourcePath = await resolveResource('relay/relay.js');
      if (resourcePath) {
        console.log('[client-node] Found bundled relay at:', resourcePath);
        return resourcePath;
      }
    } catch (err) {
      console.warn('[client-node] Resource path resolve failed:', err);
    }
  }

  return 'apps/relay/dist/index.js';
}

async function spawnRelay(
  config: ClientNodeConfig,
  resolvedPath: string,
  addLog: (line: string) => void,
): Promise<{ pid: number }> {
  if (!await isTauri()) {
    throw new Error('Client Node is only available in the desktop app');
  }

  // @ts-ignore
  const { Command } = await import('@tauri-apps/plugin-shell');

  // Set NODE_PATH so native modules (better-sqlite3) are found next to the bundle
  const relayDir = resolvedPath.replace(/[/\\][^/\\]+$/, ''); // parent dir of relay.js

  const env: Record<string, string> = {
    MUSTER_WS_PORT: String(config.port),
    MUSTER_NODE_URL: `ws://0.0.0.0:${config.port}`,
    MUSTER_RETENTION_DAYS: config.mode === 'client' ? '0' : '30',
    MUSTER_NODE_TIER: config.mode,
    MUSTER_MAX_DISK_MB: String(config.maxDiskMB),
    MUSTER_MAX_BW_MB: String(config.maxBandwidthMBPerDay),
    NODE_PATH: relayDir + '/node_modules',
  };

  addLog(`[client-node] Starting relay on port ${config.port} (mode: ${config.mode})`);
  addLog(`[client-node] Entry: ${resolvedPath}`);

  // Prefer the bundled Node sidecar — pinned to a known ABI (v22 LTS),
  // independent of host Node install. Fall back to system "node" if the
  // sidecar binary is absent for some reason (older builds).
  let command: any;
  try {
    command = Command.sidecar('bin/node', [resolvedPath], { env });
    addLog('[client-node] Using bundled Node runtime (v22 LTS)');
  } catch (sidecarErr: any) {
    addLog(`[client-node] Sidecar unavailable (${sidecarErr?.message || sidecarErr}); falling back to system node`);
    command = Command.create('node', [resolvedPath], { env });
  }

  command.on('close', (data: any) => {
    addLog(`[client-node] Relay process exited with code ${data.code}`);
    childProcess = null;
  });

  let lastError: string | null = null;
  command.on('error', (error: string) => {
    lastError = error;
    addLog(`[client-node] Error: ${error}`);
  });

  command.stderr.on('data', (line: string) => {
    const text = line.trim();
    if (text) lastError = text;
    addLog(`[stderr] ${text}`);
  });

  command.stdout.on('data', (line: string) => {
    addLog(line.trim());
  });

  try {
    const child = await command.spawn();
    childProcess = child;
    return { pid: child.pid };
  } catch (err: any) {
    const raw = err?.message || String(err);
    addLog(`[client-node] Raw spawn error: ${raw}`);
    if (lastError) addLog(`[client-node] Last stderr/error: ${lastError}`);
    const hint = /ENOENT|not found|no such file|os error 2/i.test(raw)
      ? ' — "node" not found on PATH. Install Node.js ≥20 and restart the app (or restart Explorer to refresh PATH).'
      : lastError
        ? ` — ${lastError}`
        : ` — ${raw}`;
    throw new Error(`Failed to spawn relay${hint}`);
  }
}

async function killRelay(): Promise<void> {
  if (childProcess) {
    try { await childProcess.kill(); } catch { /* already dead */ }
    childProcess = null;
  }
}

// =================================================================
// Store
// =================================================================

export const useClientNodeStore = create<ClientNodeState>((set, get) => {
  const initial = loadConfig();

  return {
    config: initial,
    running: false,
    pid: null,
    logs: [],
    error: '',
    uptimeSeconds: 0,
    resolvedRelayPath: '',

    start: async () => {
      const { config, running } = get();
      if (running) return;
      if (config.mode === 'off') {
        set({ error: 'Enable Temp or Client mode first' });
        return;
      }

      set({ error: '', logs: [] });

      const addLog = (line: string) => {
        set((s) => ({ logs: [...s.logs.slice(-99), line] }));
      };

      try {
        const resolvedPath = await resolveRelayPath(config.relayPath);
        set({ resolvedRelayPath: resolvedPath });
        addLog(`[client-node] Resolved relay path: ${resolvedPath}`);

        const { pid } = await spawnRelay(config, resolvedPath, addLog);
        startTime = Date.now();

        if (uptimeInterval) clearInterval(uptimeInterval);
        uptimeInterval = setInterval(() => {
          if (get().running) {
            set({ uptimeSeconds: Math.floor((Date.now() - startTime) / 1000) });
          }
        }, 1000);

        set({ running: true, pid, error: '' });
        addLog(`[client-node] Relay started (PID: ${pid})`);
      } catch (err: any) {
        const msg = err.message || 'Failed to start relay';
        addLog(`[client-node] ERROR: ${msg}`);
        set({ error: msg });
      }
    },

    stop: async () => {
      if (uptimeInterval) { clearInterval(uptimeInterval); uptimeInterval = null; }
      try { await killRelay(); } catch { /* */ }
      set((s) => ({ logs: [...s.logs.slice(-99), '[client-node] Relay stopped'], running: false, pid: null, uptimeSeconds: 0 }));
    },

    setMode: (mode) => { const config = { ...get().config, mode }; set({ config }); saveConfig(config); },
    setPort: (port) => { const config = { ...get().config, port }; set({ config }); saveConfig(config); },
    setMaxDisk: (mb) => { const config = { ...get().config, maxDiskMB: mb }; set({ config }); saveConfig(config); },
    setMaxBandwidth: (mb) => { const config = { ...get().config, maxBandwidthMBPerDay: mb }; set({ config }); saveConfig(config); },
    setAutoStart: (auto) => { const config = { ...get().config, autoStart: auto }; set({ config }); saveConfig(config); },
    setRelayPath: (p) => { const config = { ...get().config, relayPath: p }; set({ config }); saveConfig(config); },
    hostCommunity: (id) => {
      const config = { ...get().config };
      if (!config.hostedCommunityIds.includes(id)) { config.hostedCommunityIds = [...config.hostedCommunityIds, id]; set({ config }); saveConfig(config); }
    },
    unhostCommunity: (id) => {
      const config = { ...get().config }; config.hostedCommunityIds = config.hostedCommunityIds.filter((x) => x !== id); set({ config }); saveConfig(config);
    },
    clearLogs: () => set({ logs: [] }),
  };
});

(window as any).__clientNode = useClientNodeStore;
