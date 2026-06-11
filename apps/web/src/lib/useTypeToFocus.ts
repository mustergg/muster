/**
 * useTypeToFocus — focus the chat composer as soon as the user starts typing,
 * even if focus was lost by clicking elsewhere (Discord-style). Ignores
 * shortcuts and when an input/textarea/editable already has focus.
 */

import { useEffect } from 'react';
import type React from 'react';

export function useTypeToFocus(ref: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return; // shortcuts
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return; // already typing somewhere
      // A single printable character (or Backspace) → jump into the composer.
      if (e.key.length === 1 || e.key === 'Backspace') {
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ref]);
}
