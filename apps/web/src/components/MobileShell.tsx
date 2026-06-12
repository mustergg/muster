/**
 * MobileShell — single-column phone layout (portrait-first, responsive).
 *
 * Structure (top → bottom):
 *   - Top nav bar: horizontal GuildsSidebar (communities / squads / DMs /
 *     friends / settings). Pull-down fullscreen grid comes in a later phase.
 *   - Compact header: hamburger (left drawer) · title · members (right drawer).
 *   - Main: MainContent fills; left/right drawers overlay it.
 *   - User panel pinned at the bottom (voice bar + status), always reachable
 *     for quick mute / disconnect.
 *
 * Left drawer holds the context list (channels / DM list / squad sidebar);
 * right drawer holds the community member list. Both are overlays that never
 * cover the bottom user panel.
 */
import React, { useEffect, useState } from 'react';
import GuildsSidebar from './GuildsSidebar.js';
import ChannelsSidebar from './ChannelsSidebar.js';
import DMConversationList from './DMConversationList.js';
import SquadSidebar from './SquadSidebar.js';
import MembersSidebar from './MembersSidebar.js';
import MainContent from './MainContent.js';
import UserPanel from './UserPanel.js';
import { useCommunityStore } from '../stores/communityStore.js';
import { useSquadStore } from '../stores/squadStore.js';
import type { ActiveLocation, ViewMode } from './layoutTypes.js';
import type { SquadRoom } from '../stores/squadStore.js';

interface Props {
  viewMode: ViewMode;
  active: ActiveLocation | null;
  activeSquad: string | null;
  squadMode: SquadRoom;
  activeCommunityId: string | null;
  activeDMPartner: string | null;
  onSelectCommunity: (id: string) => void;
  onSelectDM: () => void;
  onSelectFriends: () => void;
  onSelectSettings: () => void;
  onSelectSquad: (id: string) => void;
  onSelectChannel: (communityId: string, channelId: string, channelName: string) => void;
  onSelectDMPartner: (publicKey: string) => void;
  onSelectSquadMode: (mode: SquadRoom) => void;
  onOpenDM: (publicKey: string) => void;
}

export default function MobileShell(props: Props): React.JSX.Element {
  const {
    viewMode, active, activeSquad, squadMode, activeCommunityId, activeDMPartner,
  } = props;

  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  const communities = useCommunityStore((s) => s.communities);
  const squadName = useSquadStore((s) =>
    activeSquad ? (s.allMySquads().find((q) => q.id === activeSquad)?.name ?? 'Squad') : '',
  );

  // Mirror MainLayout's "special view" detection so the members drawer only
  // exists where the desktop shows MembersSidebar.
  const isFeed = active?.channelId === '__feed__';
  const isSquadChan = /^__squad_(?:text|voice)__/.test(active?.channelId ?? '');
  const activeCommunity = activeCommunityId ? communities[activeCommunityId] : null;
  const chData = activeCommunity?.channels?.find((c: any) => c.id === active?.channelId);
  const isVoice = chData?.type === 'voice' || chData?.type === 'voice-temp';
  const isSpecial = isFeed || isSquadChan || isVoice;

  const hasLeft = viewMode === 'community' || viewMode === 'dm' || viewMode === 'squad';
  const hasRight = viewMode === 'community' && !isSpecial;

  // Open the left drawer automatically when a view is entered with nothing
  // selected yet; close drawers when there's no left drawer for the view.
  useEffect(() => {
    setRightOpen(false);
    if (viewMode === 'community' && activeCommunityId && !active) setLeftOpen(true);
    else if (viewMode === 'dm' && !activeDMPartner) setLeftOpen(true);
    else if (!hasLeft) setLeftOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, activeCommunityId]);

  const title =
    viewMode === 'settings' ? 'Settings'
    : viewMode === 'friends' ? 'Friends'
    : viewMode === 'dm' ? 'Direct Messages'
    : viewMode === 'squad' ? squadName
    : (active?.channelName ?? activeCommunity?.name ?? 'Muster');

  const leftContent =
    viewMode === 'community' ? (
      <ChannelsSidebar
        mobile
        communityId={activeCommunityId}
        activeChannelId={active?.channelId ?? null}
        onSelectChannel={(c, ch, n) => { props.onSelectChannel(c, ch, n); setLeftOpen(false); }}
      />
    ) : viewMode === 'dm' ? (
      <DMConversationList
        mobile
        activeConversation={activeDMPartner}
        onSelectConversation={(pk) => { props.onSelectDMPartner(pk); setLeftOpen(false); }}
      />
    ) : viewMode === 'squad' && activeSquad ? (
      <SquadSidebar
        mobile
        squadId={activeSquad}
        activeMode={squadMode}
        onSelectMode={(m) => { props.onSelectSquadMode(m); setLeftOpen(false); }}
        onJoinCommunity={props.onSelectCommunity}
        onOpenDM={props.onOpenDM}
      />
    ) : null;

  return (
    <div style={s.root}>
      <div style={s.topbar}>
        <GuildsSidebar
          horizontal
          activeCommunityId={activeCommunityId}
          onSelectCommunity={props.onSelectCommunity}
          dmActive={viewMode === 'dm'}
          onSelectDM={props.onSelectDM}
          friendsActive={viewMode === 'friends'}
          onSelectFriends={props.onSelectFriends}
          settingsActive={viewMode === 'settings'}
          onSelectSettings={props.onSelectSettings}
          activeSquadId={activeSquad ?? (active?.channelId?.match(/^__squad_(?:text|voice)__(.+)$/)?.[1] ?? null)}
          onSelectSquad={props.onSelectSquad}
        />
      </div>

      {(hasLeft || hasRight) && (
        <div style={s.header}>
          {hasLeft ? (
            <button style={s.hbtn} onClick={() => setLeftOpen((o) => !o)} title="Channels">{'☰'}</button>
          ) : <span style={s.hbtnSpacer} />}
          <span style={s.title}>{title}</span>
          {hasRight ? (
            <button style={s.hbtn} onClick={() => setRightOpen((o) => !o)} title="Members">{'\u{1F465}'}</button>
          ) : <span style={s.hbtnSpacer} />}
        </div>
      )}

      <div style={s.main}>
        <div style={s.contentWrap}>
          <MainContent
            viewMode={viewMode}
            active={active}
            activeSquad={activeSquad}
            squadMode={squadMode}
            activeCommunityId={activeCommunityId}
            activeDMPartner={activeDMPartner}
            onOpenDM={props.onOpenDM}
          />
        </div>

        {hasLeft && (
          <>
            {leftOpen && <div className="m-backdrop" onClick={() => setLeftOpen(false)} />}
            <div className={`m-drawer m-drawer-left ${leftOpen ? '' : 'closed'}`} style={s.leftDrawer}>
              {leftContent}
            </div>
          </>
        )}

        {hasRight && (
          <>
            {rightOpen && <div className="m-backdrop" onClick={() => setRightOpen(false)} />}
            <div className={`m-drawer m-drawer-right ${rightOpen ? '' : 'closed'}`} style={s.rightDrawer}>
              <MembersSidebar mobile communityId={activeCommunityId} onOpenDM={props.onOpenDM} />
            </div>
          </>
        )}
      </div>

      <UserPanel />
    </div>
  );
}

const s = {
  root: { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minHeight: 0 } as React.CSSProperties,
  topbar: { flexShrink: 0, paddingTop: 'var(--safe-top)' } as React.CSSProperties,
  header: { height: 'var(--mobile-header-h)', display: 'flex', alignItems: 'center', gap: '8px', padding: '0 8px', background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 } as React.CSSProperties,
  hbtn: { width: '36px', height: '36px', borderRadius: '8px', background: 'transparent', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } as React.CSSProperties,
  hbtnSpacer: { width: '36px', flexShrink: 0 } as React.CSSProperties,
  title: { flex: 1, minWidth: 0, fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)', textAlign: 'center' as const, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } as React.CSSProperties,
  main: { flex: 1, position: 'relative' as const, display: 'flex', minHeight: 0, overflow: 'hidden' } as React.CSSProperties,
  contentWrap: { flex: 1, display: 'flex', flexDirection: 'column' as const, minWidth: 0, minHeight: 0, overflow: 'hidden' } as React.CSSProperties,
  leftDrawer: { width: '82%', maxWidth: '320px', background: 'var(--color-bg-secondary)', boxShadow: '2px 0 16px rgba(0,0,0,0.4)' } as React.CSSProperties,
  rightDrawer: { width: '78%', maxWidth: '300px', background: 'var(--color-bg-secondary)', boxShadow: '-2px 0 16px rgba(0,0,0,0.4)' } as React.CSSProperties,
} as const;
