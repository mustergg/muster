/**
 * messageFx — shared helpers for replies, @mention highlighting, and the
 * reusable attention "flash" used across every chat surface.
 *
 * Reply metadata rides INSIDE the (encrypted) message content via a control-
 * char marker, so it stays E2E and needs no protocol/DB changes:
 *   RPL<originalMessageId><actual text>
 */

const REPLY_PREFIX = 'RPL'; // start marker, unlikely in normal text
const SEP = '';                   // separates id from text

/** Wrap text as a reply to `originalId`. */
export function packReply(originalId: string, text: string): string {
  return `${REPLY_PREFIX}${originalId}${SEP}${text}`;
}

/** Split a message body into its optional replyTo id and the displayed text. */
export function parseReply(content: string): { replyTo?: string; text: string } {
  if (typeof content !== 'string' || !content.startsWith(REPLY_PREFIX)) return { text: content };
  const rest = content.slice(REPLY_PREFIX.length);
  const idx = rest.indexOf(SEP);
  if (idx < 0) return { text: content };
  return { replyTo: rest.slice(0, idx), text: rest.slice(idx + 1) };
}

/** Short preview of a (already-decrypted) message body for reply chips. */
export function replyPreview(content: string, max = 99): string {
  const { text } = parseReply(content || '');
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine;
}

/** Scroll to a message (by id) and flash it to draw attention. */
export function flashMessage(messageId: string): void {
  const el = document.getElementById(`msg-${messageId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('msg-flash');
  void (el as HTMLElement).offsetWidth; // force reflow so it re-triggers
  el.classList.add('msg-flash');
  window.setTimeout(() => el.classList.remove('msg-flash'), 1600);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Does `text` @mention `username`? */
export function mentionsUser(text: string, username?: string | null): boolean {
  if (!username || !text) return false;
  return new RegExp(`(^|\\s)@${escapeRegex(username)}(\\b|$|[^\\w])`, 'i').test(text);
}

// First-time-seen tracking for mention flashes (per account, localStorage).
const LS_SEEN_MENTIONS = 'muster-seen-mentions';
function loadSeen(myKey: string): Set<string> {
  try { const r = localStorage.getItem(`${LS_SEEN_MENTIONS}:${myKey}`); return new Set(r ? JSON.parse(r) as string[] : []); } catch { return new Set(); }
}
function saveSeen(myKey: string, set: Set<string>): void {
  try { localStorage.setItem(`${LS_SEEN_MENTIONS}:${myKey}`, JSON.stringify([...set].slice(-500))); } catch { /* ignore */ }
}

/** True the FIRST time a given mention message is seen (then records it so it
 *  won't flash again). */
export function isFirstMentionView(myKey: string, messageId: string): boolean {
  if (!myKey) return false;
  const seen = loadSeen(myKey);
  if (seen.has(messageId)) return false;
  seen.add(messageId);
  saveSeen(myKey, seen);
  return true;
}
