/**
 * layoutPrefStore — user override to force the mobile layout on any screen.
 *
 * Lets desktop/browser users opt into the single-column mobile shell (handy for
 * tuning the mobile UI without a device, and for people who prefer it on a
 * vertical monitor). useIsMobile() ORs this with the width breakpoint.
 */
import { create } from 'zustand';

const LS_KEY = 'muster-force-mobile';
const LS_DM_BUBBLES = 'muster-dm-bubbles';
const DM_BUBBLES_DEFAULT = 3;

function load(): boolean {
  try { return localStorage.getItem(LS_KEY) === '1'; } catch { return false; }
}
function persist(v: boolean): void {
  try { localStorage.setItem(LS_KEY, v ? '1' : '0'); } catch { /* ignore */ }
}
function loadDmBubbles(): number {
  try { const r = localStorage.getItem(LS_DM_BUBBLES); if (r !== null) { const n = parseInt(r, 10); if (!Number.isNaN(n)) return Math.max(0, Math.min(10, n)); } } catch { /* ignore */ }
  return DM_BUBBLES_DEFAULT;
}
function persistDmBubbles(n: number): void {
  try { localStorage.setItem(LS_DM_BUBBLES, String(n)); } catch { /* ignore */ }
}

interface LayoutPrefState {
  forceMobile: boolean;
  setForceMobile: (v: boolean) => void;
  toggleForceMobile: () => void;
  /** Max non-pinned unread DM bubbles shown in the guild bar (0–10). */
  maxDmBubbles: number;
  setMaxDmBubbles: (n: number) => void;
}

export const useLayoutPref = create<LayoutPrefState>((set) => ({
  forceMobile: load(),
  setForceMobile: (v) => { persist(v); set({ forceMobile: v }); },
  toggleForceMobile: () => set((st) => { const v = !st.forceMobile; persist(v); return { forceMobile: v }; }),
  maxDmBubbles: loadDmBubbles(),
  setMaxDmBubbles: (n) => { const c = Math.max(0, Math.min(10, Math.floor(n))); persistDmBubbles(c); set({ maxDmBubbles: c }); },
}));
