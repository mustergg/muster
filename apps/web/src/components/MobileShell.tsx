/**
 * MobileShell — single-column phone layout (portrait-first, responsive).
 *
 * Structure (top → bottom):
 *   - Top nav bar: horizontal GuildsSidebar (communities / squads / DMs /
 *     friends / settings). Pull-down fullscreen grid comes in a later phase.
 *   - Compact header: hamburger (left drawer) · title · members (right drawer).
 *   - Main: MainContent fills; left/right drawers overlay or flank it.
 *   - User panel pinned at the bottom (voice bar + status), always reachable
 *     for quick mute / disconnect.
 *
 * Left drawer (channels / DM list / squad sidebar) has three states:
 *   - open  — full-width overlay with a backdrop (pick a channel).
 *   - rail  — a thin in-flow column showing the list scaled down (~half size),
 *             with the selected row emphasised; selecting a channel collapses
 *             the open drawer to this rail instead of hiding it.
 *   - closed — hidden (only when there's nothing to list).
 * The hamburger toggles open ↔ rail.
 *
 * Right drawer (community members) is a plain overlay. Swipe right→left opens
 * it; swipe left→right opens the left drawer.
 */
import React, { useEffect, useRef, useState } from 'react';
import GuildsSidebar from './GuildsSidebar.js';
import ChannelsSidebar from './ChannelsSidebar.js';
import DMConversationList from './DMConversationList.js';
import SquadSidebar from './SquadSidebar.js';
import MembersSidebar from './MembersSidebar.js';
import MainContent from './MainContent.js';
import MobileNavGrid from './MobileNavGrid.js';
import UserPanel from './UserPanel.js';
import { useCommunityStore } from '../stores/communityStore.js';
import { useSquadStore } from '../stores/squadStore.js';
import type { ActiveLocation, ViewMode } from './layoutTypes.js';
import type { SquadRoom } from '../stores/squadStore.js';

type LeftState = 'open' | 'rail' | 'closed';

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

const SWIPE_MIN = 60;     // px of horizontal travel to count as a swipe
const SWIPE_RATIO = 1.5;  // horizontal must dominate vertical by this factor

export default function MobileShell(props: Props): React.JSX.Element {
  const {
    viewMode, active, activeSquad, squadMode, activeCommunityId, activeDMPartner,
  } = props;

  const [leftState, setLeftState] = useState<LeftState>('closed');
  const [rightOpen, setRightOpen] = useState(false);
  const [navGridOpen, setNavGridOpen] = useState(false);

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

  // Resolve the left drawer state when the view (or selected community)
  // changes: open when nothing is picked yet, rail once there's a selection,
  // closed when the view has no list at all.
  useEffect(() => {
    setRightOpen(false);
    if (viewMode === 'community') setLeftState(!activeCommunityId ? 'closed' : active ? 'rail' : 'open');
    else if (viewMode === 'dm') setLeftState(activeDMPartner ? 'rail' : 'open');
    else if (viewMode === 'squad') setLeftState('open');
    else setLeftState('closed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, activeCommunityId]);

  const title =
    viewMode === 'settings' ? 'Settings'
    : viewMode === 'friends' ? 'Friends'
    : viewMode === 'dm' ? 'Direct Messages'
    : viewMode === 'squad' ? squadName
    : (active?.channelName ?? activeCommunity?.name ?? 'Muster');

  // Collapse the open left drawer to its rail when a list item is chosen.
  const collapseLeft = (): void => setLeftState('rail');
  const toggleLeft = (): void => setLeftState((st) => (st === 'open' ? 'rail' : 'open'));

  const leftContent =
    viewMode === 'community' ? (
      <ChannelsSidebar
        mobile
        communityId={activeCommunityId}
        activeChannelId={active?.channelId ?? null}
        onSelectChannel={(c, ch, n) => { props.onSelectChannel(c, ch, n); collapseLeft(); }}
      />
    ) : viewMode === 'dm' ? (
      <DMConversationList
        mobile
        activeConversation={activeDMPartner}
        onSelectConversation={(pk) => { props.onSelectDMPartner(pk); collapseLeft(); }}
      />
    ) : viewMode === 'squad' && activeSquad ? (
      <SquadSidebar
        mobile
        squadId={activeSquad}
        activeMode={squadMode}
        onSelectMode={(m) => { props.onSelectSquadMode(m); collapseLeft(); }}
        onJoinCommunity={props.onSelectCommunity}
        onOpenDM={props.onOpenDM}
      />
    ) : null;

  // ── Swipe: right→left opens members, left→right opens channels ──
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent): void => {
    const p = e.touches[0];
    if (p) touch.current = { x: p.clientX, y: p.clientY, t: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent): void => {
    const start = touch.current;
    const p = e.changedTouches[0];
    touch.current = null;
    if (!start || !p) return;
    const dx = p.clientX - start.x;
    const dy = p.clientY - start.y;
    if (Date.now() - start.t > 600) return;
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;
    if (dx < 0) {
      // swipe left
      if (hasRight) setRightOpen(true);
      else if (hasLeft && leftState === 'open') setLeftState('rail');
    } else {
      // swipe right
      if (rightOpen) setRightOpen(false);
      else if (hasLeft) setLeftState('open');
    }
  };

  // ── Top bar: pull down opens the nav grid, pull up closes it ──
  const topTouch = useRef<{ y: number; t: number } | null>(null);
  const onTopStart = (e: React.TouchEvent): void => {
    const p = e.touches[0];
    if (p) topTouch.current = { y: p.clientY, t: Date.now() };
  };
  const onTopEnd = (e: React.TouchEvent): void => {
    const start = topTouch.current;
    const p = e.changedTouches[0];
    topTouch.current = null;
    if (!start || !p || Date.now() - start.t > 600) return;
    const dy = p.clientY - start.y;
    if (dy > 36) setNavGridOpen(true);
    else if (dy < -36) setNavGridOpen(false);
  };

  return (
    <div style={s.root}>
      <div style={s.topbar} onTouchStart={onTopStart} onTouchEnd={onTopEnd}>
        <div style={s.topbarScroll}>
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
        <button style={s.chevron} onClick={() => setNavGridOpen((o) => !o)} title="All communities & squads">
          {navGridOpen ? '▴' : '▾'}
        </button>
      </div>

      {navGridOpen ? (
        <MobileNavGrid
          onSelectCommunity={props.onSelectCommunity}
          onSelectSquad={props.onSelectSquad}
          onClose={() => setNavGridOpen(false)}
        />
      ) : (
        <>
          {(hasLeft || hasRight) && (
            <div style={s.header}>
              {hasLeft ? (
                <button style={s.leftToggle} onClick={toggleLeft} title="Channels">{leftState === 'open' ? '◂' : '▸'}</button>
              ) : <span style={s.hbtnSpacer} />}
              <span style={s.title}>{title}</span>
              {hasRight ? (
                <button style={s.hbtn} onClick={() => setRightOpen((o) => !o)} title="Members">{'\u{1F465}'}</button>
              ) : <span style={s.hbtnSpacer} />}
            </div>
          )}

          <div style={s.main} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {hasLeft && leftState === 'rail' && (
              <div className="m-rail-slot" onClick={() => setLeftState('open')} title="Open">
                <div className="m-rail-inner">{leftContent}</div>
              </div>
            )}

            {hasLeft && leftState === 'open' && (
              <>
                <div className="m-backdrop" onClick={collapseLeft} />
                <div className="m-drawer m-drawer-left" style={s.leftDrawer}>{leftContent}</div>
              </>
            )}

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

            {hasRight && (
              <>
                {rightOpen && <div className="m-backdrop" onClick={() => setRightOpen(false)} />}
                <div className={`m-drawer m-drawer-right ${rightOpen ? '' : 'closed'}`} style={s.rightDrawer}>
                  <MembersSidebar mobile communityId={activeCommunityId} onOpenDM={props.onOpenDM} />
                </div>
              </>
            )}
          </div>
        </>
      )}

      <UserPanel />
    </div>
  );
}

const s = {
  root: { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minHeight: 0 } as React.CSSProperties,
  topbar: { flexShrink: 0, paddingTop: 'var(--safe-top)', display: 'flex', alignItems: 'stretch', background: 'var(--color-bg-tertiary)' } as React.CSSProperties,
  topbarScroll: { flex: 1, minWidth: 0 } as React.CSSProperties,
  chevron: { flexShrink: 0, width: '100px', border: 'none', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' } as React.CSSProperties,
  header: { height: 'var(--mobile-header-h)', display: 'flex', alignItems: 'center', gap: '8px', padding: '0 8px', background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 } as React.CSSProperties,
  hbtn: { width: '36px', height: '36px', borderRadius: '8px', background: 'transparent', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } as React.CSSProperties,
  leftToggle: { width: '100px', height: '36px', borderRadius: '8px', background: 'transparent', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } as React.CSSProperties,
  hbtnSpacer: { width: '36px', flexShrink: 0 } as React.CSSProperties,
  title: { flex: 1, minWidth: 0, fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)', textAlign: 'center' as const, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } as React.CSSProperties,
  main: { flex: 1, position: 'relative' as const, display: 'flex', minHeight: 0, overflow: 'hidden' } as React.CSSProperties,
  contentWrap: { flex: 1, display: 'flex', flexDirection: 'column' as const, minWidth: 0, minHeight: 0, overflow: 'hidden' } as React.CSSProperties,
  leftDrawer: { width: '41%', maxWidth: '160px', background: 'var(--color-bg-secondary)', boxShadow: '2px 0 16px rgba(0,0,0,0.4)' } as React.CSSProperties,
  rightDrawer: { width: '78%', maxWidth: '300px', background: 'var(--color-bg-secondary)', boxShadow: '-2px 0 16px rgba(0,0,0,0.4)' } as React.CSSProperties,
} as const;
