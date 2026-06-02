/**
 * Read Receipts — reciprocal "seen" with a global default + per-chat toggle.
 *
 * Defaults: receipts are ON for new chats unless the user flips the global
 * preference off (Settings → General).
 *
 * Reciprocity: if you don't broadcast your reads (toggle OFF for a context),
 * you only get to see the reads that others *manually* marked — never their
 * automatic ones. With the toggle ON you see everything. Manual
 * "mark as seen" always shows both ways.
 *
 * context = 'channel' | 'dm' | 'squad'; contextId is the channelId / squadId
 * / stable DM channel key. Keyed by `${context}:${contextId}`.
 */

import { create } from 'zustand';
import { useNetworkStore } from './networkStore';
import type { TransportMessage } from '@muster/transport';

export type ReceiptContext = 'channel' | 'dm' | 'squad';

export interface Receipt { reader: string; username: string; ts: number; manual: boolean; }

function ctxKey(context: ReceiptContext, contextId: string): string {
  return `${context}:${contextId}`;
}

const LS_OVERRIDES = 'muster-read-receipts';     // ctxKey -> boolean (explicit on/off)
const LS_SINCE = 'muster-read-receipts-since';   // ctxKey -> ts (when explicitly enabled)
const LS_DEFAULT = 'muster-read-receipts-default'; // '0' | '1'

function loadJSON<T>(k: string, fallback: T): T {
  try { const r = localStorage.getItem(k); return r ? JSON.parse(r) as T : fallback; } catch { return fallback; }
}
function saveJSON(k: string, v: unknown): void { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }
function loadDefault(): boolean {
  try { const r = localStorage.getItem(LS_DEFAULT); return r === null ? true : r === '1'; } catch { return true; }
}

interface ReadReceiptState {
  defaultOn: boolean;
  /** ctxKey → explicit on/off (overrides defaultOn). */
  overrides: Record<string, boolean>;
  /** ctxKey → ts when explicitly enabled (gate for "only after toggle"). */
  since: Record<string, number>;
  /** ctxKey → messageId → receipts (for OWN messages). */
  receipts: Record<string, Record<string, Receipt[]>>;
  _sent: Set<string>;

  setDefaultOn: (on: boolean) => void;
  isEnabled: (context: ReceiptContext, contextId: string) => boolean;
  setEnabled: (context: ReceiptContext, contextId: string, on: boolean) => void;
  /** Auto-ack a message if receipts are enabled + it post-dates the gate. */
  ack: (context: ReceiptContext, contextId: string, messageId: string, msgTs: number, to?: string) => void;
  /** Manual mark-as-seen — sends regardless of toggle (always visible). */
  markSeen: (context: ReceiptContext, contextId: string, messageId: string, to?: string) => void;
  /** Receipts for one of my own messages, filtered by reciprocity. */
  seenBy: (context: ReceiptContext, contextId: string, messageId: string) => Receipt[];
  init: () => () => void;
}

export const useReadReceiptStore = create<ReadReceiptState>((set, get) => ({
  defaultOn: loadDefault(),
  overrides: loadJSON<Record<string, boolean>>(LS_OVERRIDES, {}),
  since: loadJSON<Record<string, number>>(LS_SINCE, {}),
  receipts: {},
  _sent: new Set<string>(),

  setDefaultOn: (on) => { try { localStorage.setItem(LS_DEFAULT, on ? '1' : '0'); } catch { /* */ } set({ defaultOn: on }); },

  isEnabled: (context, contextId) => {
    const k = ctxKey(context, contextId);
    const o = get().overrides[k];
    return o === undefined ? get().defaultOn : o;
  },

  setEnabled: (context, contextId, on) => {
    const k = ctxKey(context, contextId);
    set((s) => {
      const overrides = { ...s.overrides, [k]: on };
      const since = { ...s.since };
      if (on) since[k] = Date.now(); else delete since[k];
      saveJSON(LS_OVERRIDES, overrides);
      saveJSON(LS_SINCE, since);
      return { overrides, since };
    });
  },

  ack: (context, contextId, messageId, msgTs, to) => {
    if (!get().isEnabled(context, contextId)) return;
    // Gate: only messages after an explicit enable. Default-on (no explicit
    // "since") covers all messages.
    const gate = get().since[ctxKey(context, contextId)] ?? 0;
    if (msgTs < gate) return;
    sendReceipt(context, contextId, messageId, to, get()._sent, false);
  },

  markSeen: (context, contextId, messageId, to) => {
    sendReceipt(context, contextId, messageId, to, get()._sent, true, true);
  },

  seenBy: (context, contextId, messageId) => {
    const all = get().receipts[ctxKey(context, contextId)]?.[messageId] ?? [];
    if (get().isEnabled(context, contextId)) return all;
    // Reciprocity: toggle off → only see manually-marked reads.
    return all.filter((r) => r.manual);
  },

  init: () => {
    const network = useNetworkStore.getState();
    const unsub = network.onMessage((msg: TransportMessage) => {
      if (msg.type !== 'READ_RECEIPT') return;
      const p = msg.payload as { context?: ReceiptContext; contextId?: string; messageId?: string; reader?: string; readerUsername?: string; ts?: number; manual?: boolean } | undefined;
      if (!p || !p.context || !p.contextId || !p.messageId || !p.reader) return;
      if (p.reader === useNetworkStore.getState().publicKey) return;
      const key = ctxKey(p.context, p.contextId);
      set((s) => {
        const ctx = { ...(s.receipts[key] || {}) };
        const list = ctx[p.messageId!] || [];
        const existing = list.find((r) => r.reader === p.reader);
        if (existing) {
          if (p.manual && !existing.manual) existing.manual = true; // upgrade auto→manual
          else return s;
        } else {
          ctx[p.messageId!] = [...list, { reader: p.reader!, username: p.readerUsername || p.reader!.slice(0, 8), ts: p.ts || Date.now(), manual: !!p.manual }];
        }
        return { receipts: { ...s.receipts, [key]: ctx } };
      });
    });
    return unsub;
  },
}));

function sendReceipt(context: ReceiptContext, contextId: string, messageId: string, to: string | undefined, sent: Set<string>, manual: boolean, force = false): void {
  const sentKey = `${context}:${contextId}:${messageId}:${manual ? 'm' : 'a'}`;
  if (!force && sent.has(sentKey)) return;
  sent.add(sentKey);
  const network = useNetworkStore.getState();
  if (!network.transport?.isConnected) return;
  network.transport.send({
    type: 'READ_RECEIPT',
    payload: { context, contextId, messageId, reader: network.publicKey, readerUsername: network.username, to, ts: Date.now(), manual },
    timestamp: Date.now(),
  });
}

(window as any).__readReceipts = useReadReceiptStore;
