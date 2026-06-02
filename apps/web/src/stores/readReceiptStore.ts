/**
 * Read Receipts — per-context "seen" with an opt-in toggle.
 *
 * Privacy: receipts are OFF by default per context. When the user enables
 * them for a chat/squad/community, only messages received AFTER the toggle
 * was enabled get an automatic receipt. A user can always "mark as seen" a
 * single message manually, even with the toggle off.
 *
 * context = 'channel' | 'dm' | 'squad'; contextId is the channelId / squadId
 * / stable DM channel key. Receipts are keyed by `${context}:${contextId}`.
 */

import { create } from 'zustand';
import { useNetworkStore } from './networkStore';
import type { TransportMessage } from '@muster/transport';

export type ReceiptContext = 'channel' | 'dm' | 'squad';

export interface Receipt { reader: string; username: string; ts: number; }

function ctxKey(context: ReceiptContext, contextId: string): string {
  return `${context}:${contextId}`;
}

const LS_KEY = 'muster-read-receipts';
function loadEnabled(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}
function saveEnabled(m: Record<string, number>): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}

interface ReadReceiptState {
  /** ctxKey → timestamp when receipts were enabled (absent = disabled). */
  enabled: Record<string, number>;
  /** ctxKey → messageId → receipts (for OWN messages, to show "seen"). */
  receipts: Record<string, Record<string, Receipt[]>>;
  _sent: Set<string>;

  isEnabled: (context: ReceiptContext, contextId: string) => boolean;
  setEnabled: (context: ReceiptContext, contextId: string, on: boolean) => void;
  /** Auto-ack a message if receipts are enabled + it post-dates the toggle. */
  ack: (context: ReceiptContext, contextId: string, messageId: string, msgTs: number, to?: string) => void;
  /** Manual mark-as-seen — sends regardless of toggle. */
  markSeen: (context: ReceiptContext, contextId: string, messageId: string, to?: string) => void;
  /** Receipts for one of my own messages. */
  seenBy: (context: ReceiptContext, contextId: string, messageId: string) => Receipt[];
  init: () => () => void;
}

export const useReadReceiptStore = create<ReadReceiptState>((set, get) => ({
  enabled: loadEnabled(),
  receipts: {},
  _sent: new Set<string>(),

  isEnabled: (context, contextId) => (get().enabled[ctxKey(context, contextId)] ?? 0) > 0,

  setEnabled: (context, contextId, on) => {
    const key = ctxKey(context, contextId);
    set((s) => {
      const next = { ...s.enabled };
      if (on) next[key] = Date.now(); else delete next[key];
      saveEnabled(next);
      return { enabled: next };
    });
  },

  ack: (context, contextId, messageId, msgTs, to) => {
    const key = ctxKey(context, contextId);
    const enabledAt = get().enabled[key] ?? 0;
    if (enabledAt <= 0 || msgTs < enabledAt) return;
    sendReceipt(context, contextId, messageId, to, get()._sent);
  },

  markSeen: (context, contextId, messageId, to) => {
    sendReceipt(context, contextId, messageId, to, get()._sent, true);
  },

  seenBy: (context, contextId, messageId) => {
    return get().receipts[ctxKey(context, contextId)]?.[messageId] ?? [];
  },

  init: () => {
    const network = useNetworkStore.getState();
    const unsub = network.onMessage((msg: TransportMessage) => {
      if (msg.type !== 'READ_RECEIPT') return;
      const p = msg.payload as { context?: ReceiptContext; contextId?: string; messageId?: string; reader?: string; readerUsername?: string; ts?: number } | undefined;
      if (!p || !p.context || !p.contextId || !p.messageId || !p.reader) return;
      // Ignore our own receipts echoed back.
      if (p.reader === useNetworkStore.getState().publicKey) return;
      const key = ctxKey(p.context, p.contextId);
      set((s) => {
        const ctx = { ...(s.receipts[key] || {}) };
        const list = ctx[p.messageId!] || [];
        if (list.some((r) => r.reader === p.reader)) return s; // dedup
        ctx[p.messageId!] = [...list, { reader: p.reader!, username: p.readerUsername || p.reader!.slice(0, 8), ts: p.ts || Date.now() }];
        return { receipts: { ...s.receipts, [key]: ctx } };
      });
    });
    return unsub;
  },
}));

function sendReceipt(context: ReceiptContext, contextId: string, messageId: string, to: string | undefined, sent: Set<string>, force = false): void {
  const sentKey = `${context}:${contextId}:${messageId}`;
  if (!force && sent.has(sentKey)) return;
  sent.add(sentKey);
  const network = useNetworkStore.getState();
  if (!network.transport?.isConnected) return;
  network.transport.send({
    type: 'READ_RECEIPT',
    payload: { context, contextId, messageId, reader: network.publicKey, readerUsername: network.username, to, ts: Date.now() },
    timestamp: Date.now(),
  });
}

(window as any).__readReceipts = useReadReceiptStore;
