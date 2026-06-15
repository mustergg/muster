/**
 * chatMenu — builds the right-click / long-press context-menu items for a DM,
 * squad or community. Common items (pin, mute) plus type-specific ones, so the
 * same menu shows everywhere (desktop rail, DM list, channels sidebar, mobile
 * nav grid).
 */
import type { ContextMenuItem } from './ContextMenu.js';
import { useChatPrefs, PERMANENT } from '../stores/chatPrefsStore.js';
import { useNotifModal } from '../stores/notifModalStore.js';

export type ChatKind = 'dm' | 'squad' | 'community';

export interface ChatMenuCtx {
  /** Display name (for the notifications modal title). */
  name?: string;
  // squad / community ownership gates
  isOwner?: boolean;
  // DM
  onBlock?: () => void;
  onDeleteChat?: () => void;
  // squad
  onInvite?: () => void;
  onLeaveSquad?: () => void;
  onDetach?: () => void;
  onDeleteSquad?: () => void;
  // community
  onCopyInvite?: () => void;
  onTransfer?: () => void;
  onLeaveCommunity?: () => void;
  onDeleteCommunity?: () => void;
}

/** Parse a mute duration like "15M", "2H", "3D"; bare "M"/"H"/"D" use the
 *  per-unit default (15m / 1h / 1d); empty = permanent. Returns an absolute
 *  expiry (ms), PERMANENT, or null to cancel. */
function promptMuteUntil(): number | null {
  const v = window.prompt('Mute for? e.g. 15M, 2H, 3D — leave empty = until you turn it off', '');
  if (v === null) return null;
  const s = v.trim().toUpperCase();
  if (!s) return PERMANENT;
  let n: number; let unit: string;
  const m = s.match(/^(\d+)\s*([MHD])$/);
  if (m) { n = parseInt(m[1]!, 10); unit = m[2]!; }
  else if (/^[MHD]$/.test(s)) { unit = s; n = unit === 'M' ? 15 : 1; }
  else { alert('Use like 15M, 2H or 3D (M=minutes, H=hours, D=days).'); return null; }
  const ms = unit === 'M' ? n * 60_000 : unit === 'H' ? n * 3_600_000 : n * 86_400_000;
  return Date.now() + ms;
}

export function chatMenu(kind: ChatKind, id: string, ctx: ChatMenuCtx): ContextMenuItem[] {
  const prefs = useChatPrefs.getState();
  const pinned = prefs.isPinned(id);
  const muted = prefs.isMuted(id);

  const items: ContextMenuItem[] = [
    { label: pinned ? 'Unpin' : 'Pin', icon: '\u{1F4CC}', onClick: () => useChatPrefs.getState().togglePin(id) },
  ];

  if (muted) {
    items.push({ label: 'Unmute', icon: '\u{1F514}', onClick: () => useChatPrefs.getState().setMute(id, 0) });
  } else {
    items.push({ label: 'Mute', icon: '\u{1F507}', onClick: () => useChatPrefs.getState().setMute(id, PERMANENT) });
    items.push({ label: 'Mute for…', icon: '\u{23F2}', onClick: () => { const u = promptMuteUntil(); if (u !== null) useChatPrefs.getState().setMute(id, u); } });
  }

  items.push({ label: 'Notifications…', icon: '\u{1F514}', onClick: () => useNotifModal.getState().open(kind, id, ctx.name || id) });

  if (kind === 'dm') {
    if (ctx.onBlock) items.push({ label: 'Block user', icon: '\u{1F6AB}', danger: true, onClick: ctx.onBlock });
    if (ctx.onDeleteChat) items.push({ label: 'Delete chat', icon: '\u{1F5D1}', danger: true, onClick: ctx.onDeleteChat });
  } else if (kind === 'squad') {
    if (ctx.onInvite) items.push({ label: 'Invite friend', icon: '\u{1F465}', onClick: ctx.onInvite });
    if (ctx.onLeaveSquad) items.push({ label: 'Leave squad', icon: '\u{1F6AA}', danger: true, onClick: ctx.onLeaveSquad });
    if (ctx.isOwner && ctx.onDetach) items.push({ label: 'Detach from community', icon: '\u{1F517}', onClick: ctx.onDetach });
    if (ctx.isOwner && ctx.onDeleteSquad) items.push({ label: 'Delete squad', icon: '\u{1F5D1}', danger: true, onClick: ctx.onDeleteSquad });
  } else {
    if (ctx.onCopyInvite) items.push({ label: 'Copy invite link', icon: '\u{1F517}', onClick: ctx.onCopyInvite });
    if (ctx.isOwner && ctx.onTransfer) items.push({ label: 'Transfer ownership', icon: '\u{1F451}', onClick: ctx.onTransfer });
    if (ctx.isOwner && ctx.onDeleteCommunity) items.push({ label: 'Delete community', icon: '\u{1F5D1}', danger: true, onClick: ctx.onDeleteCommunity });
    else if (ctx.onLeaveCommunity) items.push({ label: 'Leave community', icon: '\u{1F6AA}', danger: true, onClick: ctx.onLeaveCommunity });
  }

  return items;
}
