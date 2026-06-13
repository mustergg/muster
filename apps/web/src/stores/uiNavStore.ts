/**
 * uiNavStore — a tiny bridge so deep components (e.g. the shared UserPanel) can
 * trigger top-level navigation owned by MainLayout. MainLayout registers the
 * handlers on mount; callers invoke the request* methods.
 */
import { create } from 'zustand';

type Fn = () => void;

interface UiNavState {
  openSettings: Fn | null;
  setOpenSettings: (fn: Fn | null) => void;
  requestSettings: () => void;
  closeSettings: Fn | null;
  setCloseSettings: (fn: Fn | null) => void;
  requestCloseSettings: () => void;
  /** Whether the settings view is currently open (kept in sync by MainLayout). */
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  /** Open settings if closed, close them if already open. */
  toggleSettings: () => void;
}

export const useUiNav = create<UiNavState>((set, get) => ({
  openSettings: null,
  setOpenSettings: (fn) => set({ openSettings: fn }),
  requestSettings: () => { get().openSettings?.(); },
  closeSettings: null,
  setCloseSettings: (fn) => set({ closeSettings: fn }),
  requestCloseSettings: () => { get().closeSettings?.(); },
  settingsOpen: false,
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  toggleSettings: () => { const g = get(); (g.settingsOpen ? g.closeSettings : g.openSettings)?.(); },
}));
