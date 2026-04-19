/**
 * Client Node Store — R23
 *
 * Manages the embedded relay node running as a background process.
 * The Tauri desktop app can run a relay locally, turning the user's
 * PC into a Client Node or Temp Node.
 *
 * Uses @tauri-apps/plugin-shell to spawn the Node.js relay process.
 *
 * Flow:
 *   1. User enables Client Node in settings
 *   2. Store spawns: node apps/relay/dist/index.js with env vars
 *   3. Relay starts on configured port, joins network via PEX
 *   4. User disables → process killed, data persists 30 days
 */

import { create } from 'zustand';

// =================================================================
// Types
// =================================================================

export type NodeMode = 'off' | 'temp' | 'client';

export interface ClientNodeConfig {
  mode: NodeMode;
  port: number;
  /** Max disk usage in MB. */
  maxDiskMB: number;
  /** Max bandwidth in MB/day. */
  maxBandwidthMBPerDay: number;
  /** Communities to permanently host (client mode). */
  hostedCommunityIds: string[];
  /** Auto-start on app launch. */
  autoStart: boolean;
  /** Path to relay entry point (auto-detected or manual). */
  relayPath: string;
}

interface ClientNodeState {
  config: ClientNodeConfig;
  /** Whether the relay process is running. */
  running: boolean;
  /** Process ID if running. */
  pid: number | null;
  /** Recent log lines from the relay. */
  logs: string[];
  /** Error message if start failed. */
  error: string;
  /** Uptime in seconds. */
  uptimeSeconds: number;

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
// Process management via Tauri
// =================================================================

let childProcess: any = null;
let startTime = 0;
let uptimeInterval: ReturnType<typeof setInterval> | null = null;

async function isTauri(): Promise<boolean> {
  return typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
}

async function spawnRelay(config: ClientNodeConfig, addLog: (line: string) => void): Promise<{ pid: number }> {
  if (!await isTauri()) {
    throw new Error('Client Node is only available in the desktop app');
  }

  // @ts-ignore — only available inside Tauri desktop app
  const { Command } = await import('@tauri-apps/plugin-shell');

  // Determine relay path
  let relayEntry = config.relayPath;
  if (!relayEntry) {
    // Try common paths relative to app
    relayEntry = 'apps/relay/dist/index.js';
  }

  // Environment variables for the relay
  const env: Record<string, string> = {
    MUSTER_WS_PORT: String(config.port),
    MUSTER_NODE_URL: `ws://0.0.0.0:${config.port}`,
    MUSTER_RETENTION_DAYS: config.mode === 'client' ? '0' : '30',
    MUSTER_NODE_TIER: config.mode,
    MUSTER_MAX_DISK_MB: String(config.maxDiskMB),
    MUSTER_MAX_BW_MB: String(config.maxBandwidthMBPerDay),
  };

  // Build env string for the command
  const envArgs = Object.entries(env).map(([k, v]) => `${k}=${v}`);

  addLog(`[client-node] Starting relay on port ${config.port} (mode: ${config.mode})`);
  addLog(`[client-node] Entry: ${relayEntry}`);

  // Spawn node process
  const command = Command.create('node', [relayEntry], {
    env,
    cwd: undefined, // Will use app's cwd
  });

  command.on('close', (data: any) => {
    addLog(`[client-node] Relay process exited with code ${data.code}`);
    childProcess = null;
  });

  command.on('error', (error: string) => {
    addLog(`[client-node] Error: ${error}`);
  });

  command.stdout.on('data', (line: string) => {
    addLog(line.trim());
  });

  command.stderr.on('data', (line: string) => {
    addLog(`[stderr] ${line.trim()}`);
  });

  const child = await command.spawn();
  childProcess = child;

  return { pid: child.pid };
}

async function killRelay(): Promise<void> {
  if (childProcess) {
    try {
      await childProcess.kill();
    } catch { /* already dead */ }
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

    start: async () => {
      const { config, running } = get();
      if (running) return;
      if (config.mode === 'off') {
        set({ error: 'Enable Temp or Client mode first' });
        return;
      }

      set({ error: '', logs: [] });

      const addLog = (line: string) => {
        set((s) => ({
          logs: [...s.logs.slice(-99), line], // Keep last 100 lines
        }));
      };

      try {
        const { pid } = await spawnRelay(config, addLog);
        startTime = Date.now();

        // Update uptime every second
        if (uptimeInterval) clearInterval(uptimeInterval);
        uptimeInterval = setInterval(() => {
          if (get().running) {
            set({ uptimeSeconds: Math.floor((Date.now() - startTime) / 1000) });
          }
        }, 1000);

        set({ running: true, pid, error: '' });
        addLog(`[client-node] Relay started (PID: ${pid})`);
      } catch (err: any) {
        set({ error: err.message || 'Failed to start relay' });
      }
    },

    stop: async () => {
      if (uptimeInterval) { clearInterval(uptimeInterval); uptimeInterval = null; }

      try {
        await killRelay();
      } catch { /* ignore */ }

      const addLog = (line: string) => {
        set((s) => ({ logs: [...s.logs.slice(-99), line] }));
      };
      addLog('[client-node] Relay stopped');

      set({ running: false, pid: null, uptimeSeconds: 0 });
    },

    setMode: (mode: NodeMode) => {
      const config = { ...get().config, mode };
      set({ config });
      saveConfig(config);
    },

    setPort: (port: number) => {
      const config = { ...get().config, port };
      set({ config });
      saveConfig(config);
    },

    setMaxDisk: (mb: number) => {
      const config = { ...get().config, maxDiskMB: mb };
      set({ config });
      saveConfig(config);
    },

    setMaxBandwidth: (mb: number) => {
      const config = { ...get().config, maxBandwidthMBPerDay: mb };
      set({ config });
      saveConfig(config);
    },

    setAutoStart: (auto: boolean) => {
      const config = { ...get().config, autoStart: auto };
      set({ config });
      saveConfig(config);
    },

    setRelayPath: (path: string) => {
      const config = { ...get().config, relayPath: path };
      set({ config });
      saveConfig(config);
    },

    hostCommunity: (id: string) => {
      const config = { ...get().config };
      if (!config.hostedCommunityIds.includes(id)) {
        config.hostedCommunityIds = [...config.hostedCommunityIds, id];
        set({ config });
        saveConfig(config);
      }
    },

    unhostCommunity: (id: string) => {
      const config = { ...get().config };
      config.hostedCommunityIds = config.hostedCommunityIds.filter((x) => x !== id);
      set({ config });
      saveConfig(config);
    },

    clearLogs: () => set({ logs: [] }),
  };
});

(window as any).__clientNode = useClientNodeStore;
