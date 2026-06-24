/**
 * GuildsSidebar — R11 update
 *
 * Changes:
 * - Added Friends button between DM and communities
 * - New props: friendsActive, onSelectFriends
 */

import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useCommunityStore } from '../stores/communityStore.js';
import { useDMStore } from '../stores/dmStore.js';
import { useFriendStore } from '../stores/friendStore.js';
import { useNetworkStore } from '../stores/networkStore.js';
import { useSquadStore } from '../stores/squadStore.js';
import { useChatPrefs, orderItems } from '../stores/chatPrefsStore.js';
import { useLayoutPref } from '../stores/layoutPrefStore.js';
import { chatMenu } from './chatMenu.js';
import CreateCommunityModal from '../pages/CreateCommunityModal.js';
import JoinCommunityModal from '../pages/JoinCommunityModal.js';
import CreateSquadGlobalModal from '../pages/CreateSquadGlobalModal.js';
import TransferOwnershipModal from '../pages/TransferOwnershipModal.js';
import ContextMenu from './ContextMenu.js';

interface Props {
  activeCommunityId: string | null;
  onSelectCommunity: (id: string) => void;
  dmActive?: boolean;
  onSelectDM?: () => void;
  /** Currently open DM partner (so its bubble stays while you're in it). */
  activeDMPartner?: string | null;
  /** Open a DM conversation directly from its guild-bar bubble. */
  onOpenDM?: (publicKey: string, username?: string) => void;
  friendsActive?: boolean;
  onSelectFriends?: () => void;
  settingsActive?: boolean;
  onSelectSettings?: () => void;
  activeSquadId?: string | null;
  onSelectSquad?: (squadId: string) => void;
  /** Horizontal top-bar variant for the mobile shell. */
  horizontal?: boolean;
}

/** Avatar initials: ≥2 words → first letter of the first two words; a single
 *  word → its first two letters. Shared by DMs, squads and communities. */
function initials(name: string, fallback = '?'): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function squadInitials(name: string): string { return initials(name, 'SQ'); }
function dmInitials(name: string): string { return initials(name); }
function communityInitials(name: string): string { return initials(name); }

function communityColor(id: string): { color: string; bg: string } {
  const hue = parseInt(id.slice(0, 4), 16) % 360;
  return { color: `hsl(${hue},60%,65%)`, bg: `hsl(${hue},40%,18%)` };
}

export default function GuildsSidebar({ activeCommunityId, onSelectCommunity, dmActive, onSelectDM, activeDMPartner, onOpenDM, friendsActive, onSelectFriends, settingsActive, onSelectSettings, activeSquadId, onSelectSquad, horizontal }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { communities, loadCommunities, leaveCommunity, myRoles, communityOrder, setCommunityOrder } = useCommunityStore();
  const { conversations } = useDMStore();
  const clearConversation = useDMStore((s) => s.clearConversation);
  const blockUser = useFriendStore((s) => s.blockUser);
  const { publicKey: myKey } = useNetworkStore();
  const mySquads = useSquadStore((s) => s.allMySquads());
  const setSquadOrder = useSquadStore((s) => s.setSquadOrder);
  const leaveSquad = useSquadStore((s) => s.leaveSquad);
  const detachSquad = useSquadStore((s) => s.detachSquad);
  const deleteSquad = useSquadStore((s) => s.deleteSquad);
  const inviteSquadMember = useSquadStore((s) => s.inviteMember);
  const navLastUsed = useChatPrefs((s) => s.lastUsed);
  const navPinned = useChatPrefs((s) => s.pins);
  const navActivity = useChatPrefs((s) => s.activity);
  const navMutes = useChatPrefs((s) => s.mutes);
  const maxDmBubbles = useLayoutPref((s) => s.maxDmBubbles);
  const [dragCommunityId, setDragCommunityId] = useState<string | null>(null);
  const [dragSquadId, setDragSquadId] = useState<string | null>(null);
  const [showCreateSquad, setShowCreateSquad] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin,   setShowJoin]   = useState(false);
  const [showMenu,   setShowMenu]   = useState(false);
  const [transferCommunity, setTransferCommunity] = useState<{ id: string; name: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  // Add-menu popover position, anchored to the + button each open. Uses fixed
  // positioning so it escapes the guild bar's overflow clip (vertical scroll
  // forces horizontal clipping too) and sits right next to the button.
  const [menuPos, setMenuPos] = useState<React.CSSProperties>({});
  const toggleAddMenu = (): void => {
    setShowMenu((v) => {
      const next = !v;
      const r = addBtnRef.current?.getBoundingClientRect();
      if (next && r) {
        setMenuPos(horizontal
          ? { position: 'fixed', top: Math.round(r.bottom + 8), right: Math.max(8, Math.round(window.innerWidth - r.right)) }
          : { position: 'fixed', left: Math.round(r.right + 8), bottom: Math.max(8, Math.round(window.innerHeight - r.bottom)) });
      }
      return next;
    });
  };

  useEffect(() => { loadCommunities(); }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('join')) setShowJoin(true);
  }, []);
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  // Listen for OWNER_CANNOT_LEAVE from relay
  useEffect(() => {
    const network = useNetworkStore.getState();
    const unsub = network.onMessage((msg) => {
      if (msg.type === 'OWNER_CANNOT_LEAVE') {
        const p = msg.payload as any;
        const community = communities[p.communityId];
        if (community) {
          setTransferCommunity({ id: p.communityId, name: community.name });
        }
      }
    });
    return unsub;
  }, [communities]);

  // Order communities by the saved client-side order; any not yet in the
  // order list are appended in their natural order.
  const communityList = (() => {
    const all = Object.values(communities);
    const pos = new Map(communityOrder.map((id, i) => [id, i]));
    return all.slice().sort((a, b) => {
      const pa = pos.has(a.id) ? pos.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const pb = pos.has(b.id) ? pos.get(b.id)! : Number.MAX_SAFE_INTEGER;
      return pa - pb;
    });
  })();

  // Reorder pinned items (the only manually-orderable ones; the rest are
  // activity-ordered). Reorders within the shared pins list, which syncs across
  // devices/layouts via chatPrefs.
  const reorderPins = (dragId: string, targetId: string): boolean => {
    const cp = useChatPrefs.getState();
    if (!cp.isPinned(dragId) || !cp.isPinned(targetId)) return false;
    const ids = [...cp.pins];
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return false;
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    cp.setPinOrder(ids);
    return true;
  };

  const handleSquadDrop = (targetId: string): void => {
    if (!dragSquadId || dragSquadId === targetId) { setDragSquadId(null); return; }
    if (!reorderPins(dragSquadId, targetId)) {
      const ids = mySquads.map((s) => s.id);
      const from = ids.indexOf(dragSquadId);
      const to = ids.indexOf(targetId);
      if (from >= 0 && to >= 0) { ids.splice(to, 0, ids.splice(from, 1)[0]!); setSquadOrder(ids); }
    }
    setDragSquadId(null);
  };

  const handleCommunityDrop = (targetId: string): void => {
    if (!dragCommunityId || dragCommunityId === targetId) { setDragCommunityId(null); return; }
    if (!reorderPins(dragCommunityId, targetId)) {
      const ids = communityList.map((c) => c.id);
      const from = ids.indexOf(dragCommunityId);
      const to = ids.indexOf(targetId);
      if (from >= 0 && to >= 0) { ids.splice(to, 0, ids.splice(from, 1)[0]!); setCommunityOrder(ids); }
    }
    setDragCommunityId(null);
  };

  const pendingFriends = useFriendStore((s) => s.incomingRequests.length);

  // DM bubbles in the guild bar: pinned chats always show; on top of those, the
  // most-recent unread (unopened) chats up to the user's limit; anything unread
  // beyond that collapses into a "+N" badge on the DM button. The conversation
  // you're currently in stays shown until you leave it.
  const dmMuted = (pk: string): boolean => {
    const m = navMutes[pk];
    if (m == null) return false;
    if (m === -1) return true;
    return m > Date.now();
  };
  const pinPos = new Map(navPinned.map((id, i) => [id, i]));
  const pinnedDMs = conversations
    .filter((c) => navPinned.includes(c.publicKey))
    .sort((a, b) => (pinPos.get(a.publicKey)! - pinPos.get(b.publicKey)!));
  const unreadDMsList = conversations
    .filter((c) => !navPinned.includes(c.publicKey) && (c.unreadCount || 0) > 0 && !dmMuted(c.publicKey))
    .sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  const shownUnreadDMs = unreadDMsList.slice(0, maxDmBubbles);
  const dmOverflow = unreadDMsList.length - shownUnreadDMs.length;
  const seenDM = new Set<string>();
  const visibleDMs: typeof conversations = [];
  for (const c of [...pinnedDMs, ...shownUnreadDMs]) {
    if (!seenDM.has(c.publicKey)) { seenDM.add(c.publicKey); visibleDMs.push(c); }
  }
  if (dmActive && activeDMPartner && !seenDM.has(activeDMPartner)) {
    const ac = conversations.find((c) => c.publicKey === activeDMPartner);
    if (ac) { seenDM.add(ac.publicKey); visibleDMs.push(ac); }
  }

  const handleLeaveCommunity = (id: string, name: string) => {
    // Check if the user is the owner
    const community = communities[id];
    const isOwner = community?.ownerPublicKey === myKey;

    if (isOwner) {
      // Show transfer modal instead of simple leave
      setTransferCommunity({ id, name });
      return;
    }

    if (confirm(`Leave "${name}"? You will need an invite to rejoin.`)) {
      leaveCommunity(id);
    }
  };

  const sidebarStyle = horizontal ? { ...styles.sidebar, ...styles.sidebarH } : styles.sidebar;
  const dividerStyle = horizontal ? styles.dividerH : styles.divider;

  // Mobile top bar orders communities/squads by pin → recency; the desktop
  // rail keeps its manual drag order.
  const orderedSquads = horizontal ? orderItems(mySquads, navPinned, navActivity, navLastUsed) : mySquads;
  const orderedCommunities = horizontal ? orderItems(communityList, navPinned, navActivity, navLastUsed) : communityList;

  return (
    <>
      <div style={sidebarStyle}>
        {/* Friends button */}
        <button
          title="Friends"
          onClick={() => onSelectFriends?.()}
          style={{
            ...styles.icon,
            background: friendsActive ? 'var(--color-accent)' : 'var(--color-bg-hover)',
            color: friendsActive ? '#fff' : 'var(--color-text-secondary)',
            borderRadius: friendsActive ? '14px' : '50%',
            border: friendsActive ? '2px solid var(--color-accent)' : '2px solid transparent',
            fontSize: '16px', fontWeight: 400, position: 'relative' as const,
          }}
        >
          &#x263A;
          {pendingFriends > 0 && <span style={styles.badge}>{pendingFriends > 9 ? '9+' : pendingFriends}</span>}
        </button>

        {/* DM button */}
        <button
          title="Direct Messages"
          onClick={() => onSelectDM?.()}
          style={{
            ...styles.icon,
            background: dmActive ? 'var(--color-accent)' : 'var(--color-bg-hover)',
            color: dmActive ? '#fff' : 'var(--color-text-secondary)',
            borderRadius: dmActive ? '14px' : '50%',
            border: dmActive ? '2px solid var(--color-accent)' : '2px solid transparent',
            fontSize: '18px', fontWeight: 400, position: 'relative' as const,
          }}
        >
          DM
          {dmOverflow > 0 && <span style={styles.badge}>+{dmOverflow > 99 ? 99 : dmOverflow}</span>}
        </button>

        {/* DM conversation bubbles: pinned + recent unread (capped), plus the
            one you're currently viewing. */}
        {visibleDMs.length > 0 && (
          <>
            <div style={dividerStyle} />
            {visibleDMs.map((c) => {
              const isActive = !!dmActive && activeDMPartner === c.publicKey;
              const hue = parseInt((c.publicKey || '0000').slice(0, 4).replace(/[^0-9a-f]/gi, '0') || '0', 16) % 360;
              const unread = c.unreadCount || 0;
              const name = c.username || c.publicKey.slice(0, 8);
              return (
                <ContextMenu
                  key={c.publicKey}
                  items={chatMenu('dm', c.publicKey, {
                    name,
                    onBlock: () => { if (confirm(`Block ${name}? They won't be able to DM you.`)) blockUser(c.publicKey); },
                    onDeleteChat: () => { if (confirm(`Delete conversation with ${name}? This only clears your local copy.`)) clearConversation(c.publicKey); },
                  })}
                >
                  <button
                    title={name}
                    onClick={() => onOpenDM?.(c.publicKey, c.username)}
                    style={{
                      ...styles.icon,
                      background: `hsl(${hue},35%,22%)`, color: `hsl(${hue},65%,72%)`,
                      borderRadius: isActive ? '14px' : '50%',
                      border: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
                      position: 'relative' as const, fontSize: '13px',
                    }}
                  >
                    {dmInitials(name)}
                    {unread > 0 && <span style={styles.badge}>{unread > 9 ? '9+' : unread}</span>}
                  </button>
                </ContextMenu>
              );
            })}
          </>
        )}

        {/* Squads (personal + community) */}
        {mySquads.length > 0 && (
          <>
            <div style={dividerStyle} />
            {orderedSquads.map((sq) => {
              const isActive = activeSquadId === sq.id;
              const hue = parseInt((sq.id || '0000').slice(0, 4).replace(/[^0-9a-f]/gi, '0') || '0', 16) % 360;
              const isSquadOwner = sq.ownerPublicKey === myKey;
              return (
                <ContextMenu
                  key={sq.id}
                  items={chatMenu('squad', sq.id, {
                    name: sq.name,
                    isOwner: isSquadOwner,
                    onInvite: () => { const u = prompt(`Invite to "${sq.name}" — username:`); if (u?.trim()) inviteSquadMember(sq.id, u.trim()); },
                    onLeaveSquad: () => { if (confirm(`Leave "${sq.name}"?`)) leaveSquad(sq.id); },
                    onDetach: () => { if (confirm(`Detach "${sq.name}" from its community?`)) detachSquad(sq.id); },
                    onDeleteSquad: () => { if (confirm(`Delete "${sq.name}"? This cannot be undone.`)) deleteSquad(sq.id); },
                  })}
                >
                  <button
                    title={sq.name}
                    onClick={() => onSelectSquad?.(sq.id)}
                    draggable
                    onDragStart={(e) => { setDragSquadId(sq.id); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                    onDrop={(e) => { e.preventDefault(); handleSquadDrop(sq.id); }}
                    onDragEnd={() => setDragSquadId(null)}
                    style={{
                      ...styles.icon,
                      background: `hsl(${hue},35%,20%)`, color: `hsl(${hue},60%,70%)`,
                      borderRadius: isActive ? '14px' : '50%',
                      border: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
                      fontSize: '13px',
                      opacity: dragSquadId === sq.id ? 0.4 : 1,
                    }}
                  >
                    {squadInitials(sq.name)}
                  </button>
                </ContextMenu>
              );
            })}
          </>
        )}

        <div style={dividerStyle} />

        {/* Community icons with context menu */}
        {orderedCommunities.map((c) => {
          const { color, bg } = communityColor(c.id);
          const isActive = !dmActive && !friendsActive && activeCommunityId === c.id;
          const isOwner = c.ownerPublicKey === myKey;
          return (
            <ContextMenu
              key={c.id}
              items={chatMenu('community', c.id, {
                name: c.name,
                isOwner,
                onCopyInvite: () => navigator.clipboard.writeText(`${window.location.origin}/invite/${c.id}`),
                onTransfer: () => setTransferCommunity({ id: c.id, name: c.name }),
                onLeaveCommunity: () => handleLeaveCommunity(c.id, c.name),
              })}
            >
              <button
                title={c.name}
                onClick={() => onSelectCommunity(c.id)}
                draggable
                onDragStart={(e) => { setDragCommunityId(c.id); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                onDrop={(e) => { e.preventDefault(); handleCommunityDrop(c.id); }}
                onDragEnd={() => setDragCommunityId(null)}
                style={{
                  ...styles.icon,
                  background: bg, color,
                  borderRadius: isActive ? '14px' : '50%',
                  border: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
                  position: 'relative' as const,
                  opacity: dragCommunityId === c.id ? 0.4 : 1,
                }}
              >
                {isActive && <div style={styles.activePip} />}
                {communityInitials(c.name)}
              </button>
            </ContextMenu>
          );
        })}

        {communityList.length === 0 && <div style={styles.emptyHint}>No<br/>communities</div>}

        <div style={dividerStyle} />

        {/* Add button */}
        <div ref={menuRef} style={{ position: 'relative' as const }}>
          <button
            ref={addBtnRef}
            title={t('nav.addCommunity')}
            onClick={toggleAddMenu}
            style={{
              ...styles.icon,
              background: showMenu ? 'var(--color-accent-dim)' : 'var(--color-bg-hover)',
              color: 'var(--color-accent)', fontSize: '22px', fontWeight: 300,
              borderRadius: showMenu ? '14px' : '50%',
              border: showMenu ? '2px solid var(--color-accent-border)' : '2px solid transparent',
            }}
          >
            +
          </button>
          {showMenu && (
            <div style={{ ...styles.menuBase, ...menuPos }}>
              <button style={styles.menuItem} onClick={() => { setShowCreate(true); setShowMenu(false); }}>
                <span style={styles.menuIcon}>+</span> Create a community
              </button>
              <button style={styles.menuItem} onClick={() => { setShowCreateSquad(true); setShowMenu(false); }}>
                <span style={styles.menuIcon}>{'\u{1F465}'}</span> Create a squad
              </button>
              <div style={styles.menuDivider} />
              <button style={styles.menuItem} onClick={() => { setShowJoin(true); setShowMenu(false); }}>
                <span style={styles.menuIcon}>#</span> Join with invite link
              </button>
            </div>
          )}
        </div>

      </div>

      {showCreateSquad && <CreateSquadGlobalModal onClose={() => setShowCreateSquad(false)} />}
      {showCreate && <CreateCommunityModal onClose={() => setShowCreate(false)} onCreated={(id) => { onSelectCommunity(id); }} />}
      {showJoin && <JoinCommunityModal onClose={() => setShowJoin(false)} onJoined={(id) => { onSelectCommunity(id); }} prefillLink={new URLSearchParams(window.location.search).get('join') ? window.location.href : undefined} />}
      {transferCommunity && (
        <TransferOwnershipModal
          communityId={transferCommunity.id}
          communityName={transferCommunity.name}
          onClose={() => setTransferCommunity(null)}
          onDeleted={() => {
            setTransferCommunity(null);
            // If the deleted community was active, clear selection
            if (activeCommunityId === transferCommunity.id) {
              const remaining = Object.keys(communities).filter((id) => id !== transferCommunity.id);
              if (remaining.length > 0) onSelectCommunity(remaining[0]!);
            }
          }}
        />
      )}
    </>
  );
}

const styles = {
  sidebar: { width: 'var(--sidebar-guilds-w)', background: 'var(--color-bg-tertiary)', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', padding: '10px 0', gap: '6px', borderRight: '1px solid var(--color-border)', flexShrink: 0, overflowY: 'auto' as const, overflowX: 'visible' as const, position: 'relative' as const, zIndex: 10 } as React.CSSProperties,
  // Horizontal top-bar variant (mobile shell).
  sidebarH: { width: '100%', height: 'auto', flexDirection: 'row' as const, alignItems: 'center', padding: '8px 10px', gap: '8px', borderRight: 'none', borderBottom: '1px solid var(--color-border)', overflowX: 'auto' as const, overflowY: 'visible' as const } as React.CSSProperties,
  icon: { width: '44px', height: '44px', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '14px', fontWeight: 700, transition: 'border-radius 0.2s, border-color 0.2s, background 0.15s', flexShrink: 0 } as React.CSSProperties,
  activePip: { position: 'absolute' as const, left: '-7px', top: '50%', transform: 'translateY(-50%)', width: '4px', height: '24px', background: 'var(--color-accent)', borderRadius: '0 2px 2px 0' } as React.CSSProperties,
  divider: { width: '32px', height: '1px', background: 'var(--color-border)', margin: '2px 0', flexShrink: 0 } as React.CSSProperties,
  dividerH: { width: '1px', height: '28px', background: 'var(--color-border)', margin: '0 2px', flexShrink: 0, alignSelf: 'center' } as React.CSSProperties,
  emptyHint: { fontSize: '9px', color: 'var(--color-text-muted)', textAlign: 'center' as const, padding: '4px', lineHeight: 1.4 } as React.CSSProperties,
  badge: { position: 'absolute' as const, bottom: '-2px', right: '-2px', background: '#E24B4A', color: '#fff', fontSize: '9px', fontWeight: 700, minWidth: '16px', height: '16px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', border: '2px solid var(--color-bg-tertiary)' } as React.CSSProperties,
  // Add-menu popover — positioned (fixed) at runtime next to the + button.
  menuBase: { background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', minWidth: '200px', zIndex: 3000, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden' } as React.CSSProperties,
  menuItem: { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '12px 16px', background: 'transparent', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '13px', textAlign: 'left' as const } as React.CSSProperties,
  menuIcon: { fontSize: '16px', flexShrink: 0 } as React.CSSProperties,
  menuDivider: { height: '1px', background: 'var(--color-border)' } as React.CSSProperties,
} as const;
