/**
 * Bandwidth Store — R25 / Phase 9.
 *
 * Polls the connected relay's BandwidthMonitor (BANDWIDTH_STATS_REQUEST →
 * BANDWIDTH_STATS) and holds the latest snapshot so the UI can show a
 * small "Muster is using N KB/s" indicator.
 *
 * The numbers reflect the relay we're connected to. On desktop with a
 * Client Node running, that's the user's own node — exactly the figure the
 * roadmap wants surfaced.
 */

import { create } from 'zustand';
import { useNetworkStore } from './networkStore';
import type { TransportMessage } from '@muster/transport';

const POLL_INTERVAL_MS = 4000;

export interface BandwidthSnapshot {
  outboundBps: number;
  capBps: number;
  measuredUploadBps: number;
  measuring: boolean;
  ewmaRttMs: number;
  baselineRttMs: number;
  congested: boolean;
  inFlightCap: number;
}

interface BandwidthState {
  snapshot: BandwidthSnapshot | null;
  /** Last time a snapshot arrived (ms). 0 if never. */
  updatedAt: number;
  _timer: ReturnType<typeof setInterval> | null;
  /** Start polling + listening. Returns an unsubscribe. */
  init: () => () => void;
  /** Fire a single request now. */
  requestNow: () => void;
}

export const useBandwidthStore = create<BandwidthState>((set, get) => ({
  snapshot: null,
  updatedAt: 0,
  _timer: null,

  requestNow: () => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'BANDWIDTH_STATS_REQUEST', payload: {}, timestamp: Date.now() });
  },

  init: () => {
    const network = useNetworkStore.getState();

    const unsub = network.onMessage((msg: TransportMessage) => {
      if (msg.type !== 'BANDWIDTH_STATS') return;
      const p = msg.payload as Partial<BandwidthSnapshot> | undefined;
      if (!p) return;
      set({
        snapshot: {
          outboundBps: p.outboundBps ?? 0,
          capBps: p.capBps ?? 0,
          measuredUploadBps: p.measuredUploadBps ?? 0,
          measuring: !!p.measuring,
          ewmaRttMs: p.ewmaRttMs ?? 0,
          baselineRttMs: p.baselineRttMs ?? 0,
          congested: !!p.congested,
          inFlightCap: p.inFlightCap ?? 0,
        },
        updatedAt: Date.now(),
      });
    });

    // Kick one immediately, then poll.
    get().requestNow();
    const timer = setInterval(() => get().requestNow(), POLL_INTERVAL_MS);
    set({ _timer: timer });

    return () => {
      unsub();
      const t = get()._timer;
      if (t) clearInterval(t);
      set({ _timer: null });
    };
  },
}));

/** Format bytes/sec as a compact KB/s or MB/s string. */
export function formatBps(bps: number): string {
  if (bps <= 0) return '0 KB/s';
  if (bps < 1024 * 1024) return `${Math.max(1, Math.round(bps / 1024))} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

(window as any).__bandwidth = useBandwidthStore;
