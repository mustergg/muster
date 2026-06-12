/**
 * navRecencyStore — recency + pin ordering for the mobile top nav bar.
 *
 * The desktop guild rail keeps a manual drag order; on mobile the top bar (and
 * its pull-down grid) instead surface the communities/squads the user actually
 * uses, newest-first, with user pins kept ahead of everything. Keyed by the raw
 * community / squad id. Persisted to localStorage (manual, matching the other
 * stores).
 */
import { create } from 'zustand';

const LS_RECENT = 'muster-nav-recent';
const LS_PINNED = 'muster-nav-pinned';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function save(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

interface NavRecencyState {
  lastUsed: Record<string, number>;
  pinned: string[];
  touch: (id: string) => void;
  togglePin: (id: string) => void;
}

export const useNavRecency = create<NavRecencyState>((set) => ({
  lastUsed: load<Record<string, number>>(LS_RECENT, {}),
  pinned: load<string[]>(LS_PINNED, []),
  touch: (id) => set((st) => {
    const lastUsed = { ...st.lastUsed, [id]: Date.now() };
    save(LS_RECENT, lastUsed);
    return { lastUsed };
  }),
  togglePin: (id) => set((st) => {
    const pinned = st.pinned.includes(id) ? st.pinned.filter((p) => p !== id) : [...st.pinned, id];
    save(LS_PINNED, pinned);
    return { pinned };
  }),
}));

/**
 * Order items by: pinned (in pin order) → most-recently-used → original order.
 * Pure so callers can subscribe to `lastUsed`/`pinned` and re-sort reactively.
 */
export function orderByRecency<T extends { id: string }>(
  items: T[],
  lastUsed: Record<string, number>,
  pinned: string[],
): T[] {
  const pinPos = new Map(pinned.map((id, i) => [id, i]));
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const pa = pinPos.has(a.item.id) ? pinPos.get(a.item.id)! : Number.MAX_SAFE_INTEGER;
      const pb = pinPos.has(b.item.id) ? pinPos.get(b.item.id)! : Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      const la = lastUsed[a.item.id] ?? 0;
      const lb = lastUsed[b.item.id] ?? 0;
      if (la !== lb) return lb - la;
      return a.i - b.i; // stable fallback to original order
    })
    .map((x) => x.item);
}
