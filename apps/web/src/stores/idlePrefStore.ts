/**
 * idlePrefStore — how long without input before this device auto-sets the user
 * to "idle" (away). Minutes; 0 disables auto-idle. Default 15. Persisted.
 */
import { create } from 'zustand';

const LS_KEY = 'muster-idle-minutes';
export const DEFAULT_IDLE_MIN = 15;

function load(): number {
  try {
    const v = parseInt(localStorage.getItem(LS_KEY) || '', 10);
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_IDLE_MIN;
  } catch { return DEFAULT_IDLE_MIN; }
}

interface IdlePrefState {
  idleMinutes: number;
  setIdleMinutes: (m: number) => void;
}

export const useIdlePref = create<IdlePrefState>((set) => ({
  idleMinutes: load(),
  setIdleMinutes: (m) => { try { localStorage.setItem(LS_KEY, String(m)); } catch { /* ignore */ } set({ idleMinutes: Math.max(0, m) }); },
}));
