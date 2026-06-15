/**
 * chatPrefsStore — per-user preferences for DMs / squads / communities:
 *   - pins        : ordered ids shown first in every list (all layouts)
 *   - mutes       : id → expiry ms (no badges/notifications); 0 = not muted,
 *                   PERMANENT = until turned off
 *   - notif       : id → notification level (badge/notify policy)
 *   - activity    : id → last "relevant to me" activity time (local only)
 *   - lastUsed    : id → last opened time (local only)
 *
 * pins / mutes / notif sync across the user's devices via the relay
 * (USER_PREFS_*), unless the user turns sync off. activity / lastUsed are
 * derived locally from synced messages, so they need no syncing.
 */
import { create } from 'zustand';
import { useNetworkStore } from './networkStore';

export type NotifLevel = 'all' | 'replies_mentions' | 'mentions' | 'direct_mentions' | 'none';

/** Default notification level per target type. */
export function defaultNotif(kind: 'dm' | 'squad' | 'community'): NotifLevel {
  if (kind === 'dm') return 'all';
  if (kind === 'community') return 'replies_mentions';
  return 'all'; // squads
}

export const PERMANENT = -1; // mute with no expiry

const LS_LOCAL = 'muster-chat-prefs-local';   // activity + lastUsed + syncEnabled
const LS_SYNCED = 'muster-chat-prefs-synced';  // pins + mutes + notif (mirror of relay)

interface SyncedPrefs {
  pins: string[];
  mutes: Record<string, number>;
  notif: Record<string, NotifLevel>;
}
interface LocalPrefs {
  activity: Record<string, number>;
  lastUsed: Record<string, number>;
  syncEnabled: boolean;
}

function loadSynced(): SyncedPrefs {
  try { const r = localStorage.getItem(LS_SYNCED); if (r) return { pins: [], mutes: {}, notif: {}, ...JSON.parse(r) }; } catch { /* ignore */ }
  return { pins: [], mutes: {}, notif: {} };
}
function loadLocal(): LocalPrefs {
  try { const r = localStorage.getItem(LS_LOCAL); if (r) return { activity: {}, lastUsed: {}, syncEnabled: true, ...JSON.parse(r) }; } catch { /* ignore */ }
  return { activity: {}, lastUsed: {}, syncEnabled: true };
}

interface ChatPrefsState extends SyncedPrefs, LocalPrefs {
  togglePin: (id: string) => void;
  setPinOrder: (ids: string[]) => void;
  isPinned: (id: string) => boolean;
  setMute: (id: string, untilMs: number) => void; // 0 = unmute, PERMANENT = forever
  isMuted: (id: string) => boolean;
  setNotif: (id: string, level: NotifLevel) => void;
  getNotif: (id: string, kind: 'dm' | 'squad' | 'community') => NotifLevel;
  bumpActivity: (id: string, ts?: number) => void;
  touch: (id: string) => void; // opened
  setSyncEnabled: (v: boolean) => void;
  /** Order a list: pinned (in pin order) → activity desc → lastUsed → original. */
  order: <T extends { id: string }>(items: T[]) => T[];
  init: () => () => void;
}

function persistSynced(s: SyncedPrefs): void {
  try { localStorage.setItem(LS_SYNCED, JSON.stringify({ pins: s.pins, mutes: s.mutes, notif: s.notif })); } catch { /* ignore */ }
}
function persistLocal(s: LocalPrefs): void {
  try { localStorage.setItem(LS_LOCAL, JSON.stringify({ activity: s.activity, lastUsed: s.lastUsed, syncEnabled: s.syncEnabled })); } catch { /* ignore */ }
}

/** Pure ordering helper so components can subscribe to pins/activity/lastUsed
 *  and re-sort reactively: pinned (in pin order) → activity desc → original. */
export function orderItems<T extends { id: string }>(
  items: T[], pins: string[], activity: Record<string, number>, lastUsed: Record<string, number>,
): T[] {
  const pinPos = new Map(pins.map((id, i) => [id, i]));
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const pa = pinPos.has(a.item.id) ? pinPos.get(a.item.id)! : Number.MAX_SAFE_INTEGER;
      const pb = pinPos.has(b.item.id) ? pinPos.get(b.item.id)! : Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      const sa = Math.max(activity[a.item.id] ?? 0, lastUsed[a.item.id] ?? 0);
      const sb = Math.max(activity[b.item.id] ?? 0, lastUsed[b.item.id] ?? 0);
      if (sa !== sb) return sb - sa;
      return a.i - b.i;
    })
    .map((x) => x.item);
}

export const useChatPrefs = create<ChatPrefsState>((set, get) => {
  const pushSync = (): void => {
    const st = get();
    persistSynced(st);
    if (!st.syncEnabled) return;
    const net = useNetworkStore.getState();
    if (net.transport?.isConnected) {
      net.transport.send({ type: 'USER_PREFS_SET', payload: { pins: st.pins, mutes: st.mutes, notif: st.notif }, timestamp: Date.now() });
    }
  };

  return {
    ...loadSynced(),
    ...loadLocal(),

    togglePin: (id) => {
      set((st) => ({ pins: st.pins.includes(id) ? st.pins.filter((p) => p !== id) : [...st.pins, id] }));
      pushSync();
    },
    setPinOrder: (ids) => { set({ pins: ids }); pushSync(); },
    isPinned: (id) => get().pins.includes(id),

    setMute: (id, untilMs) => {
      set((st) => {
        const mutes = { ...st.mutes };
        if (!untilMs) delete mutes[id]; else mutes[id] = untilMs;
        return { mutes };
      });
      pushSync();
    },
    isMuted: (id) => {
      const m = get().mutes[id];
      if (m == null) return false;
      if (m === PERMANENT) return true;
      return m > Date.now();
    },

    setNotif: (id, level) => { set((st) => ({ notif: { ...st.notif, [id]: level } })); pushSync(); },
    getNotif: (id, kind) => get().notif[id] ?? defaultNotif(kind),

    bumpActivity: (id, ts) => {
      set((st) => ({ activity: { ...st.activity, [id]: ts ?? Date.now() } }));
      persistLocal(get());
    },
    touch: (id) => {
      set((st) => ({ lastUsed: { ...st.lastUsed, [id]: Date.now() } }));
      persistLocal(get());
    },

    setSyncEnabled: (v) => {
      set({ syncEnabled: v });
      persistLocal(get());
      if (v) pushSync(); // adopt local as the synced truth when re-enabled
    },

    order: (items) => {
      const { pins, activity, lastUsed } = get();
      const pinPos = new Map(pins.map((id, i) => [id, i]));
      return items
        .map((item, i) => ({ item, i }))
        .sort((a, b) => {
          const pa = pinPos.has(a.item.id) ? pinPos.get(a.item.id)! : Infinity;
          const pb = pinPos.has(b.item.id) ? pinPos.get(b.item.id)! : Infinity;
          if (pa !== pb) return pa - pb;
          const sa = Math.max(activity[a.item.id] ?? 0, lastUsed[a.item.id] ?? 0);
          const sb = Math.max(activity[b.item.id] ?? 0, lastUsed[b.item.id] ?? 0);
          if (sa !== sb) return sb - sa;
          return a.i - b.i;
        })
        .map((x) => x.item);
    },

    init: () => {
      const net = useNetworkStore.getState();
      const request = (): void => {
        if (get().syncEnabled && net.transport?.isConnected) {
          net.transport.send({ type: 'USER_PREFS_GET', payload: {}, timestamp: Date.now() });
        }
      };
      let wasConnected = net.status === 'connected';
      if (wasConnected) request();
      const unsubNet = useNetworkStore.subscribe((s) => {
        const now = s.status === 'connected';
        if (now && !wasConnected) request();
        wasConnected = now;
      });
      const unsubMsg = net.onMessage((msg) => {
        if (msg.type !== 'USER_PREFS' && msg.type !== 'USER_PREFS_SYNC') return;
        if (!get().syncEnabled) return;
        const p = msg.payload as any;
        const next: SyncedPrefs = {
          pins: Array.isArray(p.pins) ? p.pins : get().pins,
          mutes: p.mutes && typeof p.mutes === 'object' ? p.mutes : get().mutes,
          notif: p.notif && typeof p.notif === 'object' ? p.notif : get().notif,
        };
        set(next);
        persistSynced(next);
      });
      return () => { unsubNet(); unsubMsg(); };
    },
  };
});

(window as any).__chatPrefs = useChatPrefs;
