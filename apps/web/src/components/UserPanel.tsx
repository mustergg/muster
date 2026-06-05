/**
 * UserPanel — the single shared "who am I" bar shown at the bottom of every
 * left sidebar (community channels, DM list, squad sidebar).
 *
 * Shows: avatar, username, availability (click to change), a mood field
 * (Rich Presence placeholder — later carries game/music), an edit-profile
 * button and a logout button. Backed by one set of stores so all sidebars
 * stay in sync.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../stores/authStore.js';
import { useNetworkStore } from '../stores/networkStore.js';
import { useStatusStore, STATUS_OPTIONS, statusMeta, type UserAvailability } from '../stores/statusStore.js';
import EditProfileModal from '../pages/EditProfileModal.js';

export default function UserPanel(): React.JSX.Element {
  const { username, logout } = useAuthStore();
  const { status: conn, disconnect } = useNetworkStore();
  const { status, mood, setStatus, setMood } = useStatusStore();

  const [showProfile, setShowProfile] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [moodDraft, setMoodDraft] = useState(mood);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMoodDraft(mood); }, [mood]);

  // Close the status picker on outside click.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  const connected = conn === 'connected';
  const meta = connected ? statusMeta(status) : { ...statusMeta('offline'), label: conn === 'connecting' || conn === 'authenticating' ? 'Connecting…' : 'Offline' };

  const handleLogout = async (): Promise<void> => { await disconnect(); logout(); };
  const commitMood = (): void => { if (moodDraft !== mood) setMood(moodDraft.trim()); };
  const pick = (v: UserAvailability): void => { setStatus(v); setPickerOpen(false); };

  return (
    <>
      <div style={s.panel}>
        <div style={s.avatarWrap}>
          <div style={s.avatar}>{(username ?? '?').slice(0, 2).toUpperCase()}</div>
          <span style={{ ...s.dot, background: meta.color }} title={meta.label} />
        </div>

        <div style={s.info}>
          <div style={s.name}>{username}</div>
          <button style={s.statusRow} onClick={() => setPickerOpen((o) => !o)} title="Change status">
            <span style={{ ...s.statusDot, background: meta.color }} />
            <span style={s.statusLabel}>{meta.label}</span>
            <span style={s.caret}>{'▾'}</span>
          </button>
          <input
            style={s.mood}
            value={moodDraft}
            onChange={(e) => setMoodDraft(e.target.value)}
            onBlur={commitMood}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            placeholder="Set a mood…"
            maxLength={120}
          />
        </div>

        <button onClick={() => setShowProfile(true)} title="Edit profile" style={s.actionBtn}>{'⚙'}</button>
        <button onClick={handleLogout} title="Logout" style={s.actionBtn}>{'⏻'}</button>

        {pickerOpen && (
          <div ref={pickerRef} style={s.picker}>
            {STATUS_OPTIONS.map((o) => (
              <button key={o.value} style={s.pickerItem} onClick={() => pick(o.value as UserAvailability)}>
                <span style={{ ...s.statusDot, background: o.color }} />
                <span style={s.pickerLabel}>{o.label}</span>
                {status === o.value && <span style={s.pickerCheck}>{'✓'}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {showProfile && <EditProfileModal onClose={() => setShowProfile(false)} />}
    </>
  );
}

const s = {
  panel: { position: 'relative' as const, padding: '8px 10px', background: 'var(--color-bg-tertiary)', borderTop: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 } as React.CSSProperties,
  avatarWrap: { position: 'relative' as const, flexShrink: 0 } as React.CSSProperties,
  avatar: { width: '36px', height: '36px', borderRadius: '50%', background: 'var(--color-accent-dim)', border: '1.5px solid var(--color-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 600, color: 'var(--color-accent)' } as React.CSSProperties,
  dot: { position: 'absolute' as const, right: '-1px', bottom: '-1px', width: '11px', height: '11px', borderRadius: '50%', border: '2px solid var(--color-bg-tertiary)' } as React.CSSProperties,
  info: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' as const, gap: '1px' } as React.CSSProperties,
  name: { fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } as React.CSSProperties,
  statusRow: { display: 'flex', alignItems: 'center', gap: '5px', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-text-muted)' } as React.CSSProperties,
  statusDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 } as React.CSSProperties,
  statusLabel: { fontSize: '11px', color: 'var(--color-text-muted)' } as React.CSSProperties,
  caret: { fontSize: '9px', color: 'var(--color-text-muted)' } as React.CSSProperties,
  mood: { marginTop: '2px', width: '100%', background: 'transparent', border: 'none', borderBottom: '1px dashed transparent', color: 'var(--color-text-secondary)', fontSize: '11px', outline: 'none', padding: '1px 0', fontFamily: 'inherit' } as React.CSSProperties,
  actionBtn: { width: '26px', height: '26px', borderRadius: '6px', background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 } as React.CSSProperties,
  picker: { position: 'absolute' as const, bottom: 'calc(100% + 4px)', left: '10px', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: '0 6px 20px rgba(0,0,0,0.35)', padding: '4px', minWidth: '180px', zIndex: 50 } as React.CSSProperties,
  pickerItem: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '7px 10px', background: 'transparent', border: 'none', borderRadius: 'var(--radius-sm, 4px)', cursor: 'pointer', color: 'var(--color-text-primary)', textAlign: 'left' as const } as React.CSSProperties,
  pickerLabel: { flex: 1, fontSize: '13px' } as React.CSSProperties,
  pickerCheck: { color: 'var(--color-accent)', fontWeight: 700, fontSize: '12px' } as React.CSSProperties,
} as const;
