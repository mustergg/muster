/**
 * composerStore — a small bridge so the member lists can drop an @mention into
 * whatever chat composer is currently open (community channel or squad).
 *
 * The active ChatArea/SquadChatArea registers a handler on mount; clicking a
 * member calls `mention(username)`, which appends `@username ` to that input.
 * Only one chat composer is mounted at a time, so the last registration wins.
 */

import type React from 'react';
import { create } from 'zustand';

type MentionHandler = (username: string) => void;

interface ComposerState {
  handler: MentionHandler | null;
  setHandler: (h: MentionHandler | null) => void;
  /** Insert an @mention into the active composer (no-op if none mounted). */
  mention: (username: string) => void;
}

export const useComposerStore = create<ComposerState>((set, get) => ({
  handler: null,
  setHandler: (h) => set({ handler: h }),
  mention: (username) => { get().handler?.(username); },
}));

/** Append `@username ` to an existing draft, keeping spacing tidy. */
export function appendMention(text: string, username: string): string {
  const token = `@${username} `;
  if (!text) return token;
  return text.endsWith(' ') ? text + token : text + ' ' + token;
}

/**
 * Treat an @mention as one atomic token: a Backspace right after `@username `
 * deletes the whole token instead of one character. Returns true if it handled
 * the event (caller should stop). No-op for selections or non-mention text.
 */
export function handleMentionBackspace(
  e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  value: string,
  setValue: (v: string) => void,
): boolean {
  if (e.key !== 'Backspace') return false;
  const el = e.currentTarget;
  if (el.selectionStart == null || el.selectionStart !== el.selectionEnd) return false;
  const caret = el.selectionStart;
  const before = value.slice(0, caret);
  const m = before.match(/@[^\s@]+\s?$/);
  if (!m) return false;
  e.preventDefault();
  const start = caret - m[0].length;
  setValue(value.slice(0, start) + value.slice(caret));
  requestAnimationFrame(() => { try { el.setSelectionRange(start, start); } catch { /* ignore */ } });
  return true;
}
