/**
 * textScaleStore — global UI text/zoom scale (accessibility).
 *
 * Some phones render the px-based UI too small; this scales the whole app via
 * the webview `zoom` so text and layout grow together. Persisted to
 * localStorage and applied on boot (App.tsx).
 */
import { create } from 'zustand';

const LS_KEY = 'muster-text-scale';
export const TEXT_SCALES = [0.9, 1, 1.1, 1.25, 1.5] as const;

function load(): number {
  try {
    const v = parseFloat(localStorage.getItem(LS_KEY) || '');
    return Number.isFinite(v) && v > 0 ? v : 1;
  } catch { return 1; }
}

interface TextScaleState {
  scale: number;
  setScale: (v: number) => void;
}

export const useTextScale = create<TextScaleState>((set) => ({
  scale: load(),
  setScale: (v) => { try { localStorage.setItem(LS_KEY, String(v)); } catch { /* ignore */ } set({ scale: v }); },
}));
