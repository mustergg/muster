/**
 * Read-receipt UI bits shared by channel / DM / squad chats:
 *   - ReceiptToggle: header button to opt in/out of sending "seen" receipts.
 *   - SeenIndicator: shows "seen" on your own messages once acked.
 *   - MarkSeenButton: manually mark someone else's message as seen.
 */

import React from 'react';
import { useReadReceiptStore, type ReceiptContext } from '../stores/readReceiptStore.js';

export function ReceiptToggle({ context, contextId }: { context: ReceiptContext; contextId: string }): React.JSX.Element {
  const enabled = useReadReceiptStore((s) => s.isEnabled(context, contextId));
  const setEnabled = useReadReceiptStore((s) => s.setEnabled);
  return (
    <button
      onClick={() => setEnabled(context, contextId, !enabled)}
      title={enabled ? 'Read receipts ON — others see when you read (from now on). Click to turn off.' : 'Read receipts OFF. Click to let others see when you read.'}
      style={{
        width: '28px', height: '28px', borderRadius: '6px',
        border: '1px solid var(--color-border)', background: 'transparent',
        color: enabled ? 'var(--color-accent)' : 'var(--color-text-muted)',
        cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        opacity: enabled ? 1 : 0.6,
      }}
    >
      {enabled ? '\u{1F441}' : '\u{1F441}\u{200D}\u{1F5E8}'}
    </button>
  );
}

export function SeenIndicator({ context, contextId, messageId }: { context: ReceiptContext; contextId: string; messageId: string }): React.JSX.Element | null {
  const seen = useReadReceiptStore((s) => s.seenBy(context, contextId, messageId));
  if (!seen || seen.length === 0) return null;
  const names = seen.map((r) => r.username).join(', ');
  return <span style={{ fontSize: '10px', color: 'var(--color-accent)' }} title={`Seen by ${names}`}>{'✓'} seen{seen.length > 1 ? ` (${seen.length})` : ''}</span>;
}

export function MarkSeenButton({ context, contextId, messageId, to }: { context: ReceiptContext; contextId: string; messageId: string; to?: string }): React.JSX.Element {
  const markSeen = useReadReceiptStore((s) => s.markSeen);
  return (
    <button
      onClick={() => markSeen(context, contextId, messageId, to)}
      title="Mark as seen"
      style={{ width: '20px', height: '20px', borderRadius: '4px', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '11px' }}
    >
      {'\u{1F441}'}
    </button>
  );
}
