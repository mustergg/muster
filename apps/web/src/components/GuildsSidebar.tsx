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
import { useNetworkStore } from '../stores/networkStore.js';
import CreateCommunityModal from '../pages/CreateCommunityModal.js';
import JoinCommunityModal from '../pages/JoinCommunityModal.js';
import TransferOwnershipModal from '../pages/TransferOwnershipModal.js';
import ContextMenu from './ContextMenu.js';

interface Props {
  activeCommunityId: string | null;
  onSelectCommunity: (id: string) => void;
  dmActive?: boolean;
  onSelectDM?: () => void;
  friendsActive?: boolean;
  onSelectFriends?: () => void;
}

function communityInitials(name: string): string {
  return name.split(/\s+/).map((w) => w[0] ?? '').join('').toUpperCase().slice(0, 2);
}

function communityColor(id: string): { color: string; bg: string } {
  const hue = parseInt(id.slice(0, 4), 16) % 360;
  return { color: `hsl(${hue},60%,65%)`, bg: `hsl(${hue},40%,18%)` };
}

export default function GuildsSidebar({ activeCommunityId, onSelectCommunity, dmActive, onSelectDM, friendsActive, onSelectFriends }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { communities, loadCommunities, leaveCommunity, myRoles } = useCommunityStore();
  const { conversations } = useDMStore();
  const { publicKey: myKey } = useNetworkStore();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin,   setShowJoin]   = useState(false);
  const [showMenu,   setShowMenu]   = useState(false);
  const [transferCommunity, setTransferCommunity] = useState<{ id: string; name: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const communityList = Object.values(communities);
  const unreadDMs = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

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

  return (
    <>
      <div style={styles.sidebar}>
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
          {unreadDMs > 0 && <span style={styles.badge}>{unreadDMs > 9 ? '9+' : unreadDMs}</span>}
        </button>

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
            fontSize: '16px', fontWeight: 400,
          }}
        >
          &#x263A;
        </button>

        <div style={styles.divider} />

        {/* Community icons with context menu */}
        {communityList.map((c) => {
          const { color, bg } = communityColor(c.id);
          const isActive = !dmActive && !friendsActive && activeCommunityId === c.id;
          const isOwner = c.ownerPublicKey === myKey;
          return (
            <ContextMenu
              key={c.id}
              items={[
                {
                  label: 'Copy invite link',
                  icon: '\u{1F517}',
                  onClick: () => {
                    const link = `${window.location.origin}/invite/${c.id}`;
                    navigator.clipboard.writeText(link);
                  },
                },
                ...(isOwner ? [{
                  label: 'Transfer ownership',
                  icon: '\u{1F451}',
                  onClick: () => setTransferCommunity({ id: c.id, name: c.name }),
                }] : []),
                {
                  label: isOwner ? 'Leave / Delete community' : 'Leave community',
                  icon: '\u{1F6AA}',
                  danger: true,
                  onClick: () => handleLeaveCommunity(c.id, c.name),
                },
              ]}
            >
              <button
                title={c.name}
                onClick={() => onSelectCommunity(c.id)}
                style={{
                  ...styles.icon,
                  background: bg, color,
                  borderRadius: isActive ? '14px' : '50%',
                  border: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
                  position: 'relative' as const,
                }}
              >
                {isActive && <div style={styles.activePip} />}
                {communityInitials(c.name)}
              </button>
            </ContextMenu>
          );
        })}

        {communityList.length === 0 && <div style={styles.emptyHint}>No<br/>communities</div>}

        <div style={styles.divider} />

        {/* Add button */}
        <div ref={menuRef} style={{ position: 'relative' as const }}>
          <button
            title={t('nav.addCommunity')}
            onClick={() => setShowMenu((v) => !v)}
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
            <div style={styles.menu}>
              <div style={styles.menuArrow} />
              <button style={styles.menuItem} onClick={() => { setShowCreate(true); setShowMenu(false); }}>
                <span style={styles.menuIcon}>+</span> Create a community
              </button>
              <div style={styles.menuDivider} />
              <button style={styles.menuItem} onClick={() => { setShowJoin(true); setShowMenu(false); }}>
                <span style={styles.menuIcon}>#</span> Join with invite link
              </button>
            </div>
          )}
        </div>
      </div>

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
  icon: { width: '44px', height: '44px', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '14px', fontWeight: 700, transition: 'border-radius 0.2s, border-color 0.2s, background 0.15s', flexShrink: 0 } as React.CSSProperties,
  activePip: { position: 'absolute' as const, left: '-7px', top: '50%', transform: 'translateY(-50%)', width: '4px', height: '24px', background: 'var(--color-accent)', borderRadius: '0 2px 2px 0' } as React.CSSProperties,
  divider: { width: '32px', height: '1px', background: 'var(--color-border)', margin: '2px 0', flexShrink: 0 } as React.CSSProperties,
  emptyHint: { fontSize: '9px', color: 'var(--color-text-muted)', textAlign: 'center' as const, padding: '4px', lineHeight: 1.4 } as React.CSSProperties,
  badge: { position: 'absolute' as const, bottom: '-2px', right: '-2px', background: '#E24B4A', color: '#fff', fontSize: '9px', fontWeight: 700, minWidth: '16px', height: '16px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', border: '2px solid var(--color-bg-tertiary)' } as React.CSSProperties,
  menu: { position: 'fixed' as const, left: 'calc(var(--sidebar-guilds-w) + 8px)', bottom: '60px', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', minWidth: '200px', zIndex: 500, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden' } as React.CSSProperties,
  menuArrow: { position: 'absolute' as const, left: '-6px', top: '16px', width: '10px', height: '10px', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRight: 'none', borderTop: 'none', transform: 'rotate(45deg)' } as React.CSSProperties,
  menuItem: { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '12px 16px', background: 'transparent', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '13px', textAlign: 'left' as const } as React.CSSProperties,
  menuIcon: { fontSize: '16px', flexShrink: 0 } as React.CSSProperties,
  menuDivider: { height: '1px', background: 'var(--color-border)' } as React.CSSProperties,
} as const;
