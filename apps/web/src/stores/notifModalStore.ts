/** notifModalStore — opens the per-target notification-settings modal from
 *  anywhere (context menus). Rendered once by MainLayout. */
import { create } from 'zustand';
import type { ChatKind } from '../components/chatMenu';

interface Target { kind: ChatKind; id: string; name: string; }

interface NotifModalState {
  target: Target | null;
  open: (kind: ChatKind, id: string, name: string) => void;
  close: () => void;
}

export const useNotifModal = create<NotifModalState>((set) => ({
  target: null,
  open: (kind, id, name) => set({ target: { kind, id, name } }),
  close: () => set({ target: null }),
}));
