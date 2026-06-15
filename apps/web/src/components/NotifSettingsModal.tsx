/**
 * NotifSettingsModal — per-DM/squad/community notification level picker.
 * Opened from the context menus via notifModalStore.
 */
import React from 'react';
import { useNotifModal } from '../stores/notifModalStore.js';
import { useChatPrefs, type NotifLevel } from '../stores/chatPrefsStore.js';
import type { ChatKind } from './chatMenu.js';

const LABELS: Record<NotifLevel, string> = {
  all: 'All messages',
  replies_mentions: 'Replies & mentions',
  mentions: 'Mentions only',
  direct_mentions: 'Direct mentions only (no @everyone)',
  none: 'Nothing',
};

/** Levels offered per target kind (item 7 table). */
const LEVELS: Record<ChatKind, NotifLevel[]> = {
  dm: ['all', 'none'],
  squad: ['all', 'replies_mentions', 'mentions', 'direct_mentions'],
  community: ['all', 'replies_mentions', 'mentions', 'direct_mentions'],
};

export default function NotifSettingsModal(): React.JSX.Element | null {
  const target = useNotifModal((s) => s.target);
  const close = useNotifModal((s) => s.close);
  const notif = useChatPrefs((s) => s.notif);
  const getNotif = useChatPrefs((s) => s.getNotif);
  const setNotif = useChatPrefs((s) => s.setNotif);

  if (!target) return null;
  const current = target.id in notif ? notif[target.id]! : getNotif(target.id, target.kind);

  return (
    <div style={s.backdrop} onClick={close}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.title}>Notifications · {target.name}</div>
        <div style={s.list}>
          {LEVELS[target.kind].map((lvl) => (
            <button
              key={lvl}
              style={{ ...s.opt, borderColor: current === lvl ? 'var(--color-accent)' : 'var(--color-border)', background: current === lvl ? 'var(--color-accent-dim, rgba(46,117,182,0.1))' : 'var(--color-bg-secondary)' }}
              onClick={() => { setNotif(target.id, lvl); close(); }}
            >
              <span>{LABELS[lvl]}</span>
              {current === lvl && <span style={s.check}>{'✓'}</span>}
            </button>
          ))}
        </div>
        <button style={s.closeBtn} onClick={close}>Close</button>
      </div>
    </div>
  );
}

const s = {
  backdrop: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 } as React.CSSProperties,
  modal: { width: '320px', maxWidth: '90vw', background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', borderRadius: '14px', padding: '16px', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' } as React.CSSProperties,
  title: { fontSize: '15px', fontWeight: 700, marginBottom: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } as React.CSSProperties,
  list: { display: 'flex', flexDirection: 'column' as const, gap: '8px' } as React.CSSProperties,
  opt: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 13px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', color: 'var(--color-text-primary)', fontSize: '13px', textAlign: 'left' as const } as React.CSSProperties,
  check: { color: 'var(--color-accent)', fontWeight: 700 } as React.CSSProperties,
  closeBtn: { marginTop: '14px', width: '100%', padding: '9px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '13px' } as React.CSSProperties,
} as const;
