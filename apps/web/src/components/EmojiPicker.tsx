/**
 * EmojiPicker — minimal emoji button + popover. Inserts the chosen emoji
 * via onPick. Shared by ChatArea + DMChatArea.
 */

import React, { useEffect, useRef, useState } from 'react';

export const EMOJIS = [
  '😀', '😂', '🙂', '😉', '😍', '😎', '🤔', '😢', '😭', '😡',
  '👍', '👎', '👏', '🙏', '🔥', '🎉', '❤️', '💯', '✅', '❌',
  '😅', '😏', '🥳', '😴', '🤯', '🫡', '👀', '💪', '🚀', '⭐',
  '🙄', '😬', '🤝', '👋', '🤙', '😆', '😇', '🤣', '😱', '🤖',
];

export default function EmojiPicker({ onPick, style }: { onPick: (emoji: string) => void; style?: React.CSSProperties }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={style ?? s.btn}
        title="Emoji"
      >
        {'\u{1F642}'}
      </button>
      {open && (
        <div style={s.popover}>
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => { onPick(e); setOpen(false); }}
              style={s.emoji}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const s = {
  btn: { width: '30px', height: '30px', borderRadius: '6px', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } as React.CSSProperties,
  popover: { position: 'absolute' as const, bottom: '38px', right: 0, width: '264px', maxHeight: '180px', overflowY: 'auto' as const, display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '2px', padding: '8px', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: '10px', boxShadow: '0 6px 20px rgba(0,0,0,0.4)', zIndex: 1000 } as React.CSSProperties,
  emoji: { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '3px', borderRadius: '4px' } as React.CSSProperties,
} as const;
