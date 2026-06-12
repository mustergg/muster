/**
 * AutoGrowTextarea — a single-line-looking composer input that grows with its
 * content up to `maxRows` (default 3) and then scrolls. Used by every chat
 * composer (channel / squad / DM) so messages can span multiple lines on both
 * desktop and mobile. Enter-to-send / Shift+Enter-for-newline is handled by the
 * caller's onKeyDown.
 */
import React, { forwardRef, useEffect, useRef } from 'react';

interface Props {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  maxRows?: number;
  style?: React.CSSProperties;
}

const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, Props>(function AutoGrowTextarea(
  { value, onChange, onKeyDown, placeholder, disabled, maxRows = 3, style }, ref,
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  const setRefs = (el: HTMLTextAreaElement | null): void => {
    innerRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
  };

  // Recompute height whenever the value changes: reset to auto, then clamp to
  // maxRows worth of line-height and toggle scrolling past that.
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const cs = window.getComputedStyle(el);
    const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3 || 18;
    const padding = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const maxH = lineHeight * maxRows + padding + border;
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden';
  }, [value, maxRows]);

  return (
    <textarea
      ref={setRefs}
      rows={1}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      style={{ resize: 'none', overflowY: 'hidden', ...style }}
    />
  );
});

export default AutoGrowTextarea;
