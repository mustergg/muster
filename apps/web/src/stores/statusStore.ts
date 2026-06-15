/**
 * statusStore — the local user's availability + mood (Rich Presence groundwork).
 *
 * Availability is one of online / idle / dnd / invisible. 'invisible' makes the
 * user appear offline to everyone (the relay masks it) while staying fully
 * functional. Mood is a free-text line that will later carry activity.
 *
 * Multi-device:
 *  - Each device reports its last user-activity time; the relay shows presence
 *    from the most-recently-used device (dedup by public key).
 *  - After `idleMinutes` of no input THIS device auto-sets 'idle' (0 = never).
 *  - A manual status change propagates to all the user's open clients
 *    (relay STATUS_SYNC), so every device matches.
 *
 * Persisted per-account (keyed by public key) and pushed to the relay on change
 * and on every (re)connect.
 */

import { create } from 'zustand';
import { useNetworkStore } from './networkStore';
import { useIdlePref } from './idlePrefStore';

export type UserAvailability = 'online' | 'idle' | 'dnd' | 'invisible';

export interface StatusOption {
  value: UserAvailability | 'offline';
  label: string;
  color: string;
}

export const STATUS_OPTIONS: StatusOption[] = [
  { value: 'online', label: 'Online', color: '#43B581' },
  { value: 'idle', label: 'Idle', color: '#FAA61A' },
  { value: 'dnd', label: 'Do Not Disturb', color: '#E24B4A' },
  { value: 'invisible', label: 'Invisible', color: '#747F8D' },
];

const OFFLINE_OPTION: StatusOption = { value: 'offline', label: 'Offline', color: '#747F8D' };

export function statusMeta(status: string | undefined): StatusOption {
  return STATUS_OPTIONS.find((o) => o.value === status) || OFFLINE_OPTION;
}

const LS_STATUS = 'muster-user-status';
const LS_MOOD = 'muster-user-mood';
function lsKey(base: string): string {
  const pk = useNetworkStore.getState().publicKey || 'anon';
  return `${base}:${pk}`;
}
function loadStatus(): UserAvailability {
  try { const r = localStorage.getItem(lsKey(LS_STATUS)); return (r as UserAvailability) || 'online'; } catch { return 'online'; }
}
function loadMood(): string {
  try { return localStorage.getItem(lsKey(LS_MOOD)) || ''; } catch { return ''; }
}

// Last user-input time on this device (hot path — kept out of React state).
let lastActivityTs = Date.now();
let lastHeartbeat = 0;

interface StatusState {
  /** Effective status shown/sent (manual choice, or 'idle' when auto-idle). */
  status: UserAvailability;
  /** The user's explicit choice (auto-idle never overwrites this). */
  manual: UserAvailability;
  autoIdle: boolean;
  mood: string;
  setStatus: (status: UserAvailability) => void;
  setMood: (mood: string) => void;
  push: () => void;
  reload: () => void;
  init: () => () => void;
}

function send(status: UserAvailability, mood: string, manual: boolean): void {
  const net = useNetworkStore.getState();
  if (!net.transport?.isConnected) return;
  net.transport.send({
    type: 'SET_USER_STATUS',
    payload: { status, mood: mood || undefined, manual, lastActivity: lastActivityTs },
    timestamp: Date.now(),
  });
}

export const useStatusStore = create<StatusState>((set, get) => ({
  status: loadStatus(),
  manual: loadStatus(),
  autoIdle: false,
  mood: loadMood(),

  setStatus: (status) => {
    try { localStorage.setItem(lsKey(LS_STATUS), status); } catch { /* ignore */ }
    lastActivityTs = Date.now();
    set({ status, manual: status, autoIdle: false });
    send(status, get().mood, true); // manual → relay syncs to other clients
  },

  setMood: (mood) => {
    try { localStorage.setItem(lsKey(LS_MOOD), mood); } catch { /* ignore */ }
    set({ mood });
    send(get().status, mood, true);
  },

  push: () => { send(get().status, get().mood, false); },

  reload: () => { const s = loadStatus(); set({ status: s, manual: s, autoIdle: false, mood: loadMood() }); },

  init: () => {
    get().reload();
    lastActivityTs = Date.now();

    // ── Track this device's activity (cheap; no React state churn) ──
    const onActivity = (): void => {
      lastActivityTs = Date.now();
      const st = get();
      if (st.autoIdle) { // came back from auto-idle → restore the chosen status
        set({ autoIdle: false, status: st.manual });
        send(st.manual, st.mood, false);
      }
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'focus', 'scroll'];
    for (const e of events) window.addEventListener(e, onActivity, { passive: true });
    const onVis = (): void => { if (document.visibilityState === 'visible') onActivity(); };
    document.addEventListener('visibilitychange', onVis);

    // ── Idle check + activity heartbeat (so the relay's most-recent-device
    //    pick stays fresh for the active client) ──
    const tick = (): void => {
      const st = get();
      const idleMin = useIdlePref.getState().idleMinutes;
      const idleFor = Date.now() - lastActivityTs;
      if (idleMin > 0 && st.manual === 'online' && !st.autoIdle && idleFor > idleMin * 60_000) {
        set({ autoIdle: true, status: 'idle' });
        send('idle', st.mood, false);
      }
      // Heartbeat the active client every ~60s so its lastActivity wins.
      if (idleFor < 60_000 && Date.now() - lastHeartbeat > 60_000) {
        lastHeartbeat = Date.now();
        send(get().status, st.mood, false);
      }
    };
    const timer = window.setInterval(tick, 15_000);

    // Push current status on (re)connect.
    let wasConnected = useNetworkStore.getState().status === 'connected';
    if (wasConnected) get().push();
    const unsubNet = useNetworkStore.subscribe((s) => {
      const nowConnected = s.status === 'connected';
      if (nowConnected && !wasConnected) get().push();
      wasConnected = nowConnected;
    });

    // Adopt a manual status pushed from another of the user's clients.
    const unsubMsg = useNetworkStore.getState().onMessage((msg) => {
      if (msg.type !== 'STATUS_SYNC') return;
      const p = msg.payload as any;
      const s = p?.status as UserAvailability | undefined;
      if (!s) return;
      try { localStorage.setItem(lsKey(LS_STATUS), s); } catch { /* ignore */ }
      const mood = typeof p.mood === 'string' ? p.mood : get().mood;
      set({ status: s, manual: s, autoIdle: false, mood });
      send(s, mood, false); // update this connection's presence (no re-propagation)
    });

    return () => {
      for (const e of events) window.removeEventListener(e, onActivity);
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(timer);
      unsubNet();
      unsubMsg();
    };
  },
}));

(window as any).__status = useStatusStore;
