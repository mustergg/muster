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
}

export const useUiNav = create<UiNavState>((set, get) => ({
  openSettings: null,
  setOpenSettings: (fn) => set({ openSettings: fn }),
  requestSettings: () => { get().openSettings?.(); },
}));
