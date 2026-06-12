/**
 * ComposerBar — the shared chat input row (channel / squad / DM).
 *
 * Desktop: [mic][attach] · textarea · [emoji][send]. Enter sends, Shift+Enter
 * adds a newline.
 *
 * Mobile: the left controls stack vertically (mic on top, attach below) to free
 * horizontal space; the emoji control sits in the top-right corner of the send
 * button. Enter inserts a newline (send is the button). The send button sends
 * on release; holding it for 1s opens the emoji picker and cancels that send.
 */
import React, { useEffect, useRef, useState } from 'react';
import VoiceRecorder from './VoiceRecorder.js';
import EmojiPicker, { EMOJIS } from './EmojiPicker.js';
import AutoGrowTextarea from './AutoGrowTextarea.js';
import { handleMentionBackspace } from '../stores/composerStore.js';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onPickFile: () => void;
  onSendVoice: (file: File) => void;
  voiceDisabled?: boolean;
  showClear: boolean;
  onClear: () => void;
  placeholder: string;
  disabled?: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  isMobile: boolean;
  sendDisabled: boolean;
}

const LONG_PRESS_MS = 1000;

export default function ComposerBar(props: Props): React.JSX.Element {
  const {
    value, onChange, onSubmit, onPickFile, onSendVoice, voiceDisabled,
    showClear, onClear, placeholder, disabled, inputRef, isMobile, sendDisabled,
  } = props;

  const [emojiOpen, setEmojiOpen] = useState(false);
  const lpTimer = useRef<number | null>(null);
  const lpFired = useRef(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!emojiOpen) return;
    const h = (e: MouseEvent): void => { if (popRef.current && !popRef.current.contains(e.target as Node)) setEmojiOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [emojiOpen]);

  const insert = (e: string): void => { onChange(value + e); setEmojiOpen(false); inputRef.current?.focus(); };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (handleMentionBackspace(e, value, onChange)) return;
    if (e.key === 'Escape') { e.preventDefault(); onClear(); return; }
    if (e.key === 'Enter') {
      if (isMobile) return;                 // mobile: Enter = newline; send via button
      if (!e.shiftKey) { e.preventDefault(); if (!sendDisabled) onSubmit(); } // desktop: Enter sends, Shift+Enter newline
    }
  };

  // Mobile send button: tap-and-release sends; hold 1s opens emoji + cancels send.
  const clearLP = (): void => { if (lpTimer.current != null) { clearTimeout(lpTimer.current); lpTimer.current = null; } };
  const onSendDown = (): void => {
    lpFired.current = false;
    lpTimer.current = window.setTimeout(() => { lpFired.current = true; setEmojiOpen(true); }, LONG_PRESS_MS);
  };
  const onSendUp = (): void => {
    clearLP();
    if (!lpFired.current && !sendDisabled) onSubmit();
    lpFired.current = false;
  };

  return (
    <div style={cs.wrap}>
      <div style={isMobile ? cs.leftCol : cs.leftRow}>
        <VoiceRecorder onSend={onSendVoice} disabled={voiceDisabled} />
        <button onClick={onPickFile} disabled={disabled} style={cs.iconBtn} title="Attach file">
          {disabled ? '⌛' : '\u{1F4CE}'}
        </button>
      </div>

      {showClear && (
        <button onClick={onClear} style={cs.clearBtn} title="Clear (Esc)">{'✕'}</button>
      )}

      <AutoGrowTextarea
        ref={inputRef}
        style={cs.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
      />

      {isMobile ? (
        <div style={cs.sendWrap}>
          <button
            onPointerDown={onSendDown}
            onPointerUp={onSendUp}
            onPointerLeave={clearLP}
            onPointerCancel={clearLP}
            onContextMenu={(e) => e.preventDefault()}
            style={{ ...cs.sendBtn, opacity: sendDisabled ? 0.55 : 1 }}
            title="Send (hold for emoji)"
          >
            {'↑'}
          </button>
          <button type="button" style={cs.emojiCorner} onClick={() => setEmojiOpen((o) => !o)} title="Emoji">
            {'\u{1F642}'}
          </button>
          {emojiOpen && (
            <div ref={popRef} style={cs.popover}>
              {EMOJIS.map((e) => (
                <button key={e} type="button" onClick={() => insert(e)} style={cs.emoji}>{e}</button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <EmojiPicker onPick={(e) => onChange(value + e)} />
          <button onClick={onSubmit} disabled={sendDisabled} style={cs.sendBtn}>{'↑'}</button>
        </>
      )}
    </div>
  );
}

const cs = {
  wrap: { display: 'flex', alignItems: 'flex-end', gap: '4px', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '4px 8px 4px 4px' } as React.CSSProperties,
  leftRow: { display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 } as React.CSSProperties,
  leftCol: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '2px', flexShrink: 0, alignSelf: 'flex-end' } as React.CSSProperties,
  iconBtn: { width: '30px', height: '30px', borderRadius: '6px', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } as React.CSSProperties,
  clearBtn: { width: '26px', height: '26px', borderRadius: '6px', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '13px', flexShrink: 0, alignSelf: 'flex-end' } as React.CSSProperties,
  input: { flex: 1, minWidth: 0, background: 'transparent', border: 'none', color: 'var(--color-text-primary)', padding: '8px 6px', outline: 'none', fontSize: '14px', fontFamily: 'inherit', lineHeight: 1.4 } as React.CSSProperties,
  sendWrap: { position: 'relative' as const, flexShrink: 0, alignSelf: 'flex-end' } as React.CSSProperties,
  sendBtn: { width: '34px', height: '34px', borderRadius: '8px', background: 'var(--color-accent)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, touchAction: 'none' } as React.CSSProperties,
  emojiCorner: { position: 'absolute' as const, top: '-9px', right: '-9px', width: '22px', height: '22px', borderRadius: '50%', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, zIndex: 2, padding: 0 } as React.CSSProperties,
  popover: { position: 'absolute' as const, bottom: '44px', right: 0, width: '264px', maxHeight: '180px', overflowY: 'auto' as const, display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '2px', padding: '8px', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: '10px', boxShadow: '0 6px 20px rgba(0,0,0,0.4)', zIndex: 1000 } as React.CSSProperties,
  emoji: { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '3px', borderRadius: '4px' } as React.CSSProperties,
} as const;
