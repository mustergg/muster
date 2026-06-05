/**
 * SquadSidebar — left sidebar for the standalone squad view.
 *
 * Mirrors the community ChannelsSidebar layout: the squad's channels (text +
 * voice) up top, the online/offline member roster below, and the shared
 * UserPanel at the bottom. (Communities keep their members in a separate right
 * column; squads show them here instead.)
 */

import React from 'react';
import { useSquadStore, type SquadRoom } from '../stores/squadStore.js';
import { useNetworkStore } from '../stores/networkStore.js';
import { statusMeta } from '../stores/statusStore.js';
import UserPanel from './UserPanel.js';

interface Props {
  squadId: string;
  activeMode: SquadRoom;
  onSelectMode: (mode: SquadRoom) => void;
}

export default function SquadSidebar({ squadId, activeMode, onSelectMode }: Props): React.JSX.Element {
  const { publicKey: myKey } = useNetworkStore();
  const squads = useSquadStore((s) => s.squads);
  const members = useSquadStore((s) => s.members[squadId]) || [];
  const online = useSquadStore((s) => s.squadOnline[squadId]) || [];

  let squad: any = null;
  for (const list of Object.values(squads)) {
    const found = list.find((sq) => sq.id === squadId);
    if (found) { squad = found; break; }
  }

  const onlineByKey = new Map(online.map((o) => [o.publicKey, o]));
  const offline = members.filter((m) => !onlineByKey.has(m.publicKey));

  return (
    <div style={s.sidebar}>
      <div style={s.header}>
        <span style={s.title}>{squad?.name || 'Squad'}</span>
      </div>

      <div style={s.list}>
        {/* Channels */}
        <div style={s.sectionLabel}>Channels</div>
        <button
          onClick={() => onSelectMode('text')}
          style={{ ...s.channelItem, ...(activeMode === 'text' ? s.channelActive : {}) }}
        >
          <span style={s.chIcon}>#</span>
          <span style={s.chName}>text</span>
        </button>
        <button
          onClick={() => onSelectMode('voice')}
          style={{ ...s.channelItem, ...(activeMode === 'voice' ? s.channelActive : {}) }}
        >
          <span style={s.chIcon}>{'\u{1F3A4}'}</span>
          <span style={s.chName}>voice</span>
        </button>

        {/* Members */}
        {online.length > 0 && <div style={s.sectionLabel}>Online — {online.length}</div>}
        {online.map((m) => {
          const meta = statusMeta(m.status);
          return (
            <div key={m.publicKey} style={s.memberItem}>
              <span style={{ ...s.dot, background: meta.color }} title={meta.label} />
              <div style={s.memberMeta}>
                <span style={s.memberName}>{m.username}{m.publicKey === myKey ? ' (you)' : ''}</span>
                {m.mood && <span style={s.memberMood}>{m.mood}</span>}
              </div>
            </div>
          );
        })}

        {offline.length > 0 && <div style={s.sectionLabel}>Offline — {offline.length}</div>}
        {offline.map((m) => (
          <div key={m.publicKey} style={{ ...s.memberItem, opacity: 0.5 }}>
            <span style={{ ...s.dot, background: '#747F8D' }} />
            <div style={s.memberMeta}>
              <span style={s.memberName}>{m.username}</span>
            </div>
          </div>
        ))}
      </div>

      <UserPanel />
    </div>
  );
}

const s = {
  sidebar:      { width: 'var(--sidebar-channels-w)', background: 'var(--color-bg-secondary)', display: 'flex', flexDirection: 'column' as const, borderRight: '1px solid var(--color-border)', flexShrink: 0 } as React.CSSProperties,
  header:       { padding: '14px 14px 10px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center' } as React.CSSProperties,
  title:        { fontSize: '14px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } as React.CSSProperties,
  list:         { flex: 1, overflowY: 'auto' as const, padding: '8px 0' } as React.CSSProperties,
  sectionLabel: { fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' as const, padding: '10px 14px 4px' } as React.CSSProperties,
  channelItem:  { display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 14px', width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', textAlign: 'left' as const } as React.CSSProperties,
  channelActive:{ background: 'var(--color-bg-hover)', color: 'var(--color-text-primary)' } as React.CSSProperties,
  chIcon:       { width: '16px', textAlign: 'center' as const, fontSize: '13px', flexShrink: 0, fontFamily: 'var(--font-mono)' } as React.CSSProperties,
  chName:       { fontSize: '13px', flex: 1 } as React.CSSProperties,
  memberItem:   { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 14px' } as React.CSSProperties,
  dot:          { width: '9px', height: '9px', borderRadius: '50%', flexShrink: 0 } as React.CSSProperties,
  memberMeta:   { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' as const } as React.CSSProperties,
  memberName:   { fontSize: '12px', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } as React.CSSProperties,
  memberMood:   { fontSize: '10px', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } as React.CSSProperties,
} as const;
