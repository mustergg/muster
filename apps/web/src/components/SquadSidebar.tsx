/**
 * SquadSidebar — left sidebar for the standalone squad view.
 *
 * Mirrors the community ChannelsSidebar layout: the squad's channels (text +
 * voice) up top, the online/offline member roster below, and the shared
 * UserPanel at the bottom. (Communities keep their members in a separate right
 * column; squads show them here instead.)
 */

import React, { useEffect, useState } from 'react';
import { useSquadStore, type SquadRoom } from '../stores/squadStore.js';
import { useNetworkStore } from '../stores/networkStore.js';
import { useCommunityStore } from '../stores/communityStore.js';
import { statusMeta } from '../stores/statusStore.js';
import { useComposerStore } from '../stores/composerStore.js';
import ContextMenu from './ContextMenu.js';
import UserPanel from './UserPanel.js';

interface Props {
  squadId: string;
  activeMode: SquadRoom;
  onSelectMode: (mode: SquadRoom) => void;
  /** Called after the user joins the squad's parent community. */
  onJoinCommunity?: (communityId: string) => void;
  /** Open a DM with a member (gated to verified accounts). */
  onOpenDM?: (publicKey: string) => void;
  /** Mobile drawer variant: full width, no internal user panel (it's global). */
  mobile?: boolean;
}

const ROLE_BADGE: Record<string, { label: string; color: string }> = {
  owner: { label: 'owner', color: '#FFD700' },
  admin: { label: 'admin', color: '#3B82F6' },
  moderator: { label: 'mod', color: '#8B5CF6' },
};

function roleBadge(role?: string): React.JSX.Element | null {
  const b = role ? ROLE_BADGE[role] : undefined;
  if (!b) return null;
  return <span style={{ fontSize: '9px', fontWeight: 700, color: b.color, border: `1px solid ${b.color}`, borderRadius: '3px', padding: '0 4px', flexShrink: 0, textTransform: 'uppercase' }}>{b.label}</span>;
}

export default function SquadSidebar({ squadId, activeMode, onSelectMode, onJoinCommunity, onOpenDM, mobile }: Props): React.JSX.Element {
  const { publicKey: myKey, accountInfo } = useNetworkStore();
  const mention = useComposerStore((s) => s.mention);
  const canDM = accountInfo?.emailVerified ?? false;

  const memberMenu = (publicKey: string, username: string) => [
    { label: `Mention @${username}`, icon: '@', onClick: () => mention(username) },
    ...(publicKey !== myKey ? [{ label: 'Send DM', icon: '\u{1F4AC}', onClick: () => {
      if (!canDM) { alert('Verify your email to start direct messages.'); return; }
      onOpenDM?.(publicKey);
    } }] : []),
  ];
  const squads = useSquadStore((s) => s.squads);
  const members = useSquadStore((s) => s.members[squadId]) || [];
  const online = useSquadStore((s) => s.squadOnline[squadId]) || [];
  const communities = useCommunityStore((s) => s.communities);
  const previewCommunities = useCommunityStore((s) => s.previewCommunities);
  const fetchCommunity = useCommunityStore((s) => s.fetchCommunity);
  const joinCommunity = useCommunityStore((s) => s.joinCommunity);
  const [joining, setJoining] = useState(false);

  let squad: any = null;
  for (const list of Object.values(squads)) {
    const found = list.find((sq) => sq.id === squadId);
    if (found) { squad = found; break; }
  }

  // Parent community the user is NOT a member of → offer to join instead of
  // exposing its channels.
  const cid: string = squad?.communityId || '';
  const isRealCommunity = !!cid && !cid.startsWith('personal:');
  const isMember = isRealCommunity && !!communities[cid];
  const showJoin = isRealCommunity && !isMember;
  const communityName = communities[cid]?.name || previewCommunities[cid]?.name || '';

  // Fetch the community name (preview only) for the Join CTA.
  useEffect(() => {
    if (showJoin && !communityName) fetchCommunity(cid);
  }, [showJoin, communityName, cid]);

  const handleJoin = async (): Promise<void> => {
    if (joining) return;
    setJoining(true);
    try {
      await joinCommunity(cid);
      onJoinCommunity?.(cid);
    } catch (err) {
      console.warn('[squad] join community failed:', err);
    } finally {
      setJoining(false);
    }
  };

  const onlineByKey = new Map(online.map((o) => [o.publicKey, o]));
  const offline = members.filter((m) => !onlineByKey.has(m.publicKey));
  const roleByKey = new Map(members.map((m) => [m.publicKey, m]));

  return (
    <div style={mobile ? { ...s.sidebar, width: '100%', borderRight: 'none' } : s.sidebar}>
      <div style={s.header}>
        <span style={s.title}>{squad?.name || 'Squad'}</span>
      </div>

      {showJoin && (
        <div style={s.joinBanner}>
          <span style={s.joinText}>
            Part of {communityName ? `“${communityName}”` : 'a community'} — you only have access to this squad.
          </span>
          <button style={{ ...s.joinBtn, opacity: joining ? 0.6 : 1 }} onClick={handleJoin} disabled={joining}>
            {joining ? 'Joining…' : 'Join community'}
          </button>
        </div>
      )}

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
            <ContextMenu key={m.publicKey} items={memberMenu(m.publicKey, m.username)}>
              <div style={{ ...s.memberItem, cursor: 'pointer' }} onClick={() => mention(m.username)} title={`Mention @${m.username} · right-click for more`}>
                <span style={{ ...s.dot, background: meta.color }} title={meta.label} />
                <div style={s.memberMeta}>
                  <span style={s.memberName}>{m.username}{m.publicKey === myKey ? ' (you)' : ''}</span>
                  {m.mood && <span style={s.memberMood}>{m.mood}</span>}
                </div>
                {roleBadge(roleByKey.get(m.publicKey)?.role)}
              </div>
            </ContextMenu>
          );
        })}

        {offline.length > 0 && <div style={s.sectionLabel}>Offline — {offline.length}</div>}
        {offline.map((m) => (
          <ContextMenu key={m.publicKey} items={memberMenu(m.publicKey, m.username)}>
            <div style={{ ...s.memberItem, opacity: 0.5, cursor: 'pointer' }} onClick={() => mention(m.username)} title={`Mention @${m.username} · right-click for more`}>
              <span style={{ ...s.dot, background: '#747F8D' }} />
              <div style={s.memberMeta}>
                <span style={s.memberName}>{m.username}{m.ghost ? ' · staff' : ''}</span>
              </div>
              {roleBadge(m.role)}
            </div>
          </ContextMenu>
        ))}
      </div>

      {!mobile && <UserPanel />}
    </div>
  );
}

const s = {
  sidebar:      { width: 'var(--sidebar-channels-w)', background: 'var(--color-bg-secondary)', display: 'flex', flexDirection: 'column' as const, borderRight: '1px solid var(--color-border)', flexShrink: 0 } as React.CSSProperties,
  header:       { padding: '14px 14px 10px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center' } as React.CSSProperties,
  title:        { fontSize: '14px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } as React.CSSProperties,
  joinBanner:   { padding: '10px 14px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-tertiary)', display: 'flex', flexDirection: 'column' as const, gap: '8px', flexShrink: 0 } as React.CSSProperties,
  joinText:     { fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: 1.4 } as React.CSSProperties,
  joinBtn:      { padding: '7px 12px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
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
