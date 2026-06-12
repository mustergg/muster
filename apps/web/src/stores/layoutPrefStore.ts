/**
 * layoutPrefStore — user override to force the mobile layout on any screen.
 *
 * Lets desktop/browser users opt into the single-column mobile shell (handy for
 * tuning the mobile UI without a device, and for people who prefer it on a
 * vertical monitor). useIsMobile() ORs this with the width breakpoint.
 */
import { create } from 'zustand';

const LS_KEY = 'muster-force-mobile';

function load(): boolean {
  try { return localStorage.getItem(LS_KEY) === '1'; } catch { return false; }
}
function persist(v: boolean): void {
  try { localStorage.setItem(LS_KEY, v ? '1' : '0'); } catch { /* ignore */ }
}

interface LayoutPrefState {
  forceMobile: boolean;
  setForceMobile: (v: boolean) => void;
  toggleForceMobile: () => void;
}

export const useLayoutPref = create<LayoutPrefState>((set) => ({
  forceMobile: load(),
  setForceMobile: (v) => { persist(v); set({ forceMobile: v }); },
  toggleForceMobile: () => set((st) => { const v = !st.forceMobile; persist(v); return { forceMobile: v }; }),
}));
