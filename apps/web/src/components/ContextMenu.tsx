/**
 * ContextMenu — a small popup menu triggered by right-click or long-press.
 * Used for DM conversations and community items.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  onClick: () => void;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  children: React.ReactElement;
}

export default function ContextMenu({ items, children }: ContextMenuProps): React.JSX.Element {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!show) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShow(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [show]);

  // Close on Escape
  useEffect(() => {
    if (!show) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShow(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [show]);

  // Right-click handler
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPos({ x: e.clientX, y: e.clientY });
    setShow(true);
  }, []);

  // Long-press handlers (mobile + desktop)
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    longPressTimer.current = setTimeout(() => {
      setPos({ x: e.clientX, y: e.clientY });
      setShow(true);
    }, 600); // 600ms long press
  }, []);

  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handlePointerLeave = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  return (
    <>
      <div
        ref={containerRef}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        style={{ userSelect: 'none' }}
      >
        {children}
      </div>

      {show && (
        <div
          ref={menuRef}
          style={{
            ...styles.menu,
            left: `${Math.min(pos.x, window.innerWidth - 200)}px`,
            top: `${Math.min(pos.y, window.innerHeight - items.length * 40 - 16)}px`,
          }}
        >
          {items.map((item, i) => (
            <button
              key={i}
              onClick={() => { item.onClick(); setShow(false); }}
              style={{
                ...styles.menuItem,
                color: item.danger ? '#E24B4A' : 'var(--color-text-secondary)',
              }}
            >
              {item.icon && <span style={styles.menuIcon}>{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

const styles = {
  menu: {
    position: 'fixed' as const,
    background: 'var(--color-bg-secondary)',
    border: '1px solid var(--color-border)',
    borderRadius: '8px',
    minWidth: '160px',
    zIndex: 1000,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    overflow: 'hidden',
    padding: '4px 0',
  } as React.CSSProperties,
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '8px 14px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: '13px',
    textAlign: 'left' as const,
    transition: 'background 0.1s',
  } as React.CSSProperties,
  menuIcon: {
    fontSize: '14px',
    flexShrink: 0,
    width: '18px',
    textAlign: 'center' as const,
  } as React.CSSProperties,
} as const;
