/**
 * statusStore — the local user's availability + mood (Rich Presence groundwork).
 *
 * Availability is one of online / idle / dnd / invisible. 'invisible' makes the
 * user appear offline to everyone (the relay masks it) while staying fully
 * functional. Mood is a free-text line that will later carry activity
 * (game / music / stream).
 *
 * Both are persisted per-account (keyed by public key) and broadcast to the
 * relay via SET_USER_STATUS — on change and on every (re)connect — so other
 * users see them in channel / squad presence.
 */

import { create } from 'zustand';
import { useNetworkStore } from './networkStore';

export type UserAvailability = 'online' | 'idle' | 'dnd' | 'invisible';

export interface StatusOption {
  value: UserAvailability | 'offline';
  label: string;
  color: string;
}

/** Display metadata for each availability (incl. derived 'offline'). */
export const STATUS_OPTIONS: StatusOption[] = [
  { value: 'online', label: 'Online', color: '#43B581' },
  { value: 'idle', label: 'Idle', color: '#FAA61A' },
  { value: 'dnd', label: 'Do Not Disturb', color: '#E24B4A' },
  { value: 'invisible', label: 'Invisible', color: '#747F8D' },
];

const OFFLINE_OPTION: StatusOption = { value: 'offline', label: 'Offline', color: '#747F8D' };

/** Resolve display metadata for any status string (defaults to offline). */
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

interface StatusState {
  status: UserAvailability;
  mood: string;
  setStatus: (status: UserAvailability) => void;
  setMood: (mood: string) => void;
  /** Send the current status+mood to the relay (called on connect). */
  push: () => void;
  /** Reload persisted values for the current account (after login). */
  reload: () => void;
  init: () => () => void;
}

function send(status: UserAvailability, mood: string): void {
  const net = useNetworkStore.getState();
  if (!net.transport?.isConnected) return;
  net.transport.send({ type: 'SET_USER_STATUS', payload: { status, mood: mood || undefined }, timestamp: Date.now() });
}

export const useStatusStore = create<StatusState>((set, get) => ({
  status: loadStatus(),
  mood: loadMood(),

  setStatus: (status) => {
    try { localStorage.setItem(lsKey(LS_STATUS), status); } catch { /* ignore */ }
    set({ status });
    send(status, get().mood);
  },

  setMood: (mood) => {
    try { localStorage.setItem(lsKey(LS_MOOD), mood); } catch { /* ignore */ }
    set({ mood });
    send(get().status, mood);
  },

  push: () => { send(get().status, get().mood); },

  reload: () => { set({ status: loadStatus(), mood: loadMood() }); },

  init: () => {
    // publicKey is known by now — load this account's persisted values.
    get().reload();
    // Push current status whenever we (re)connect.
    let wasConnected = useNetworkStore.getState().status === 'connected';
    if (wasConnected) get().push();
    const unsub = useNetworkStore.subscribe((s) => {
      const nowConnected = s.status === 'connected';
      if (nowConnected && !wasConnected) get().push();
      wasConnected = nowConnected;
    });
    return unsub;
  },
}));

(window as any).__status = useStatusStore;
