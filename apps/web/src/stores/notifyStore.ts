/**
 * notifyStore — new-message notifications across every platform.
 *
 * One entry point, `notify()`, called by the chat / DM / squad message handlers.
 * It respects the existing per-target notification level + mutes (chatPrefs) and
 * then, for a qualifying message:
 *   - plays a short "bubble" pop (Web Audio, synthesized — no asset) unless you
 *     are already looking at that exact conversation;
 *   - while the window isn't focused: bumps an unread counter that drives the
 *     tab title "(N) MusterGG", the system App Badge (Badging API, where
 *     supported — installed PWA / mobile / some browsers), and an optional
 *     desktop/browser system notification (Web Notification API; works in the
 *     Tauri desktop WebView2 too).
 *
 * Platform notes: the Web Notification API covers browsers + the desktop
 * WebView2. Android WebView has no Notification API — there it degrades to the
 * sound + title; a native Android push (Tauri notification plugin) is a separate
 * follow-up. The tab title + sound work everywhere.
 */
import { create } from 'zustand';
import { useChatPrefs, type NotifLevel } from './chatPrefsStore';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

/** Inside the Tauri shell (desktop WebView2 / Android WebView) the web
 *  Notification API is unavailable or a no-op, so we route system notifications
 *  through the Tauri notification plugin instead. */
const IS_TAURI = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

const BASE_TITLE = 'MusterGG';
const LS_SOUND = 'muster-notif-sound';
const LS_SYSTEM = 'muster-notif-system';

type NotifKind = 'dm' | 'squad' | 'community';

interface NotifyOpts {
  kind: NotifKind;
  /** id used for level/mute lookup (communityId / squadId / DM pubkey). */
  targetId: string;
  title: string;
  body?: string;
  mentioned?: boolean;
  isReplyToMe?: boolean;
  /** True when this message is for the conversation already on screen + focused. */
  activeAndFocused?: boolean;
}

interface NotifyState {
  soundEnabled: boolean;
  systemEnabled: boolean;
  unread: number;
  setSoundEnabled: (v: boolean) => void;
  setSystemEnabled: (v: boolean) => Promise<void>;
  notify: (opts: NotifyOpts) => void;
  resetBadge: () => void;
  init: () => () => void;
}

function loadBool(k: string, def: boolean): boolean {
  try { const r = localStorage.getItem(k); return r === null ? def : r === '1'; } catch { return def; }
}
function saveBool(k: string, v: boolean): void {
  try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* ignore */ }
}

// ── Sound (synthesized bubble pop) ───────────────────────────────────────────
let audioCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  try {
    if (!audioCtx) {
      const AC = (window.AudioContext || (window as any).webkitAudioContext);
      if (!AC) return null;
      audioCtx = new AC();
    }
    return audioCtx;
  } catch { return null; }
}
function resumeCtx(): void {
  const ctx = getCtx();
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}
function playPop(vol = 0.28): void {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(480, t);
  o.frequency.exponentialRampToValueAtTime(880, t + 0.12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
  o.connect(g); g.connect(ctx.destination);
  o.start(t); o.stop(t + 0.27);
}

// ── Badge / title ────────────────────────────────────────────────────────────
function applyBadge(n: number): void {
  try { document.title = n > 0 ? `(${n > 99 ? '99+' : n}) ${BASE_TITLE}` : BASE_TITLE; } catch { /* ignore */ }
  try {
    const nav = navigator as any;
    if (n > 0) nav.setAppBadge?.(n);
    else nav.clearAppBadge?.();
  } catch { /* ignore */ }
}

/** Ask for system-notification permission via the right backend. */
async function requestSystemPermission(): Promise<boolean> {
  if (IS_TAURI) {
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === 'granted';
      return granted;
    } catch { return false; }
  }
  if (typeof Notification === 'undefined') return false;
  try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
}

function showSystem(title: string, body: string): void {
  if (IS_TAURI) {
    void (async () => {
      try { if (await isPermissionGranted()) sendNotification({ title, body }); } catch { /* ignore */ }
    })();
    return;
  }
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    // eslint-disable-next-line no-new
    new Notification(title, { body, tag: 'muster-msg', silent: true, icon: '/icon.png' });
  } catch { /* ignore */ }
}

function levelAllows(level: NotifLevel, mentioned: boolean, isReplyToMe: boolean): boolean {
  switch (level) {
    case 'none': return false;
    case 'all': return true;
    case 'replies_mentions': return mentioned || isReplyToMe;
    case 'mentions':
    case 'direct_mentions': return mentioned;
    default: return true;
  }
}

export const useNotify = create<NotifyState>((set, get) => ({
  soundEnabled: loadBool(LS_SOUND, true),
  systemEnabled: loadBool(LS_SYSTEM, false),
  unread: 0,

  setSoundEnabled: (v) => { saveBool(LS_SOUND, v); set({ soundEnabled: v }); if (v) resumeCtx(); },

  setSystemEnabled: async (v) => {
    if (v) {
      const granted = await requestSystemPermission();
      if (!granted) { saveBool(LS_SYSTEM, false); set({ systemEnabled: false }); return; }
    }
    saveBool(LS_SYSTEM, v);
    set({ systemEnabled: v });
  },

  notify: ({ kind, targetId, title, body = '', mentioned = false, isReplyToMe = false, activeAndFocused = false }) => {
    const prefs = useChatPrefs.getState();
    if (prefs.isMuted(targetId)) return;
    if (!levelAllows(prefs.getNotif(targetId, kind), mentioned, isReplyToMe)) return;

    const st = get();
    const focused = typeof document !== 'undefined' && document.hasFocus();

    // Sound: skip only when you're already in that conversation and looking at it.
    if (st.soundEnabled && !activeAndFocused) playPop();

    // Away from the app → drive the badge/title + optional system notification.
    if (!focused) {
      const n = st.unread + 1;
      set({ unread: n });
      applyBadge(n);
      if (st.systemEnabled) showSystem(title, body || 'New message');
    }
  },

  resetBadge: () => { set({ unread: 0 }); applyBadge(0); },

  init: () => {
    const onFocus = (): void => { set({ unread: 0 }); applyBadge(0); resumeCtx(); };
    const onGesture = (): void => resumeCtx();
    window.addEventListener('focus', onFocus);
    window.addEventListener('pointerdown', onGesture, { once: true, passive: true });
    applyBadge(get().unread);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pointerdown', onGesture);
    };
  },
}));

(window as any).__notify = useNotify;
