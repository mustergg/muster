/**
 * ChannelsSidebar — R13 update
 *
 * Changes from R12:
 * - Added Squads section below channels with text/voice items
 * - Create squad button for community members
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/authStore.js';
import { useNetworkStore } from '../stores/networkStore.js';
import { useCommunityStore } from '../stores/communityStore.js';
import InviteLinkModal from '../pages/InviteLinkModal.js';
import CreateChannelModal from '../pages/CreateChannelModal.js';
import EditChannelModal from '../pages/EditChannelModal.js';
import EditProfileModal from '../pages/EditProfileModal.js';
import CreateSquadModal from '../pages/CreateSquadModal.js';
import { useSquadStore } from '../stores/squadStore.js';
import ContextMenu from './ContextMenu.js';

interface Props {
  communityId: string | null;
  activeChannelId: string | null;
  onSelectChannel: (communityId: string, channelId: string, channelName: string) => void;
}

const ADMIN_ROLES = new Set(['owner', 'admin']);

export default function ChannelsSidebar({ communityId, activeChannelId, onSelectChannel }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { username, logout }              = useAuthStore();
  const { status, peerCount, peerId, disconnect } = useNetworkStore();
  const { communities, subscribePresence, onlineMembers, serveCommunityRequests, myRoles, deleteChannel } = useCommunityStore();
  const [showInvite, setShowInvite] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [editingChannel, setEditingChannel] = useState<{ id: string; name: string; visibility: string } | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showCreateSquad, setShowCreateSquad] = useState(false);
  const { squads: allSquads, loadSquads: loadSquadsAction } = useSquadStore();

  const community = communityId ? communities[communityId] : null;
  const channels  = community?.channels ?? [];
  const textChannels  = channels.filter((c) => c.type === 'text' || c.type === 'feed');
  const voiceChannels = channels.filter((c) => c.type === 'voice' || c.type === 'voice-temp');
  const memberCount   = communityId ? (onlineMembers[communityId]?.length ?? 0) : 0;

  // Check if current user is admin+ in this community
  const myRole = communityId ? (myRoles[communityId] || 'member') : 'member';
  const isAdmin = ADMIN_ROLES.has(myRole);

  useEffect(() => {
    if (!communityId) return;
    console.log('[Sidebar] Setting up presence + requests for:', communityId);
    const unsubPresence  = subscribePresence(communityId);
    const unsubRequests  = serveCommunityRequests(communityId);
    loadSquadsAction(communityId);
    return () => { unsubPresence(); unsubRequests(); };
  }, [communityId]);

  const handleLogout = async (): Promise<void> => {
    await disconnect();
    logout();
  };

  const handleDeleteChannel = (channelId: string, channelName: string) => {
    if (!communityId) return;
    if (channels.length <= 1) {
      alert('Cannot delete the last channel in a community.');
      return;
    }
    if (confirm(`Delete #${channelName}? All messages in this channel will be lost.`)) {
      deleteChannel(communityId, channelId);
    }
  };

  const buildChannelContextMenu = (ch: { id: string; name: string; visibility: string }) => {
    if (!isAdmin) return [];
    return [
      {
        label: 'Edit channel',
        icon: '\u270F\uFE0F',
        onClick: () => setEditingChannel({ id: ch.id, name: ch.name, visibility: ch.visibility }),
      },
      {
        label: 'Delete channel',
        icon: '\u{1F5D1}',
        danger: true,
        onClick: () => handleDeleteChannel(ch.id, ch.name),
      },
    ];
  };

  return (
    <>
      <div style={styles.sidebar}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.serverName}>
            {community ? community.name : (communityId ? 'Loading\u2026' : t('nav.communities'))}
          </span>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={styles.peerBadge}>{peerCount} peers</span>
            {community && (
              <button
                title="Invite members"
                onClick={() => setShowInvite(true)}
                style={styles.inviteBtn}
              >
                +
              </button>
            )}
          </div>
        </div>

        {/* Channel list */}
        <div style={styles.list}>
          {!community && communityId && (
            <div style={styles.syncing}>Syncing community\u2026</div>
          )}

          {!communityId && (
            <div style={styles.emptyState}>
              Select or create a community to get started.
            </div>
          )}

          {/* Feed — always visible when community is selected */}
          {communityId && (
            <button
              onClick={() => onSelectChannel(communityId, '__feed__', 'Feed')}
              style={{ ...styles.channelItem, ...(activeChannelId === '__feed__' ? styles.channelActive : {}) }}
            >
              <span style={styles.chIcon}>{'\u{1F4F0}'}</span>
              <span style={styles.chName}>Feed</span>
            </button>
          )}

          {textChannels.length > 0 && (
            <>
              <div style={styles.sectionRow}>
                <div style={styles.sectionLabel}>{t('community.channels')}</div>
                {isAdmin && communityId && (
                  <button
                    title="Create channel"
                    onClick={() => setShowCreateChannel(true)}
                    style={styles.createChannelBtn}
                  >
                    +
                  </button>
                )}
              </div>
              {textChannels.map((ch) => {
                const menuItems = buildChannelContextMenu(ch);
                const channelButton = (
                  <button
                    key={ch.id}
                    onClick={() => communityId && onSelectChannel(communityId, ch.id, ch.name)}
                    style={{ ...styles.channelItem, ...(activeChannelId === ch.id ? styles.channelActive : {}) }}
                  >
                    <span style={styles.chIcon}>#</span>
                    <span style={styles.chName}>{ch.name}</span>
                    {ch.visibility !== 'public' && (
                      <span style={styles.visibilityBadge}>
                        {ch.visibility === 'private' ? '\u{1F512}' : ch.visibility === 'readonly' ? '\u{1F4D6}' : '\u{1F4E6}'}
                      </span>
                    )}
                  </button>
                );

                if (menuItems.length > 0) {
                  return (
                    <ContextMenu key={ch.id} items={menuItems}>
                      {channelButton}
                    </ContextMenu>
                  );
                }
                return channelButton;
              })}
            </>
          )}

          {/* Show create button even when no text channels exist yet */}
          {textChannels.length === 0 && communityId && community && isAdmin && (
            <div style={styles.sectionRow}>
              <div style={styles.sectionLabel}>{t('community.channels')}</div>
              <button
                title="Create channel"
                onClick={() => setShowCreateChannel(true)}
                style={styles.createChannelBtn}
              >
                +
              </button>
            </div>
          )}

          {voiceChannels.length > 0 && (
            <>
              <div style={{ ...styles.sectionLabel, marginTop: '12px', paddingLeft: '14px' }}>Voice</div>
              {voiceChannels.map((ch) => {
                const menuItems = buildChannelContextMenu(ch);
                const channelButton = (
                  <button key={ch.id} style={styles.channelItem}>
                    <span style={{ ...styles.chIcon, color: 'var(--color-green)' }}>&#x25C8;</span>
                    <span style={styles.chName}>{ch.name}</span>
                  </button>
                );

                if (menuItems.length > 0) {
                  return (
                    <ContextMenu key={ch.id} items={menuItems}>
                      {channelButton}
                    </ContextMenu>
                  );
                }
                return channelButton;
              })}
            </>
          )}

          {/* Squads section */}
          {communityId && (
            <>
              <div style={styles.sectionRow}>
                <div style={styles.sectionLabel}>Squads</div>
                <button
                  title="Create squad"
                  onClick={() => setShowCreateSquad(true)}
                  style={styles.createChannelBtn}
                >
                  +
                </button>
              </div>
              {(allSquads[communityId] || []).length === 0 && (
                <div style={{ padding: '4px 14px', fontSize: '11px', color: 'var(--color-text-muted)' }}>No squads yet</div>
              )}
              {(allSquads[communityId] || []).map((sq) => (
                <React.Fragment key={sq.id}>
                  <button
                    onClick={() => communityId && onSelectChannel(communityId, `__squad_text__${sq.id}`, `${sq.name}`)}
                    style={{ ...styles.channelItem, ...(activeChannelId === `__squad_text__${sq.id}` ? styles.channelActive : {}) }}
                  >
                    <span style={styles.chIcon}>#</span>
                    <span style={styles.chName}>{sq.name}</span>
                    <span style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>{sq.memberCount}</span>
                  </button>
                  <button
                    onClick={() => communityId && onSelectChannel(communityId, `__squad_voice__${sq.id}`, `${sq.name} Voice`)}
                    style={{ ...styles.channelItem, ...(activeChannelId === `__squad_voice__${sq.id}` ? styles.channelActive : {}) }}
                  >
                    <span style={styles.chIcon}>{'\u{1F3A4}'}</span>
                    <span style={styles.chName}>{sq.name} Voice</span>
                  </button>
                </React.Fragment>
              ))}
            </>
          )}
        </div>

        {/* User panel */}
        <div style={styles.userPanel}>
          <div style={styles.avatar}>{(username ?? '?').slice(0, 2).toUpperCase()}</div>
          <div style={styles.userInfo}>
            <div style={{ fontSize: '13px', fontWeight: 500 }}>{username}</div>
            <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
              {peerId ? peerId.slice(0, 16) + '\u2026' : 'not connected'}
            </div>
          </div>
          <button onClick={() => setShowProfile(true)} title="Edit profile" style={styles.actionBtn}>&#x2699;</button>
          <button onClick={handleLogout} title={t('auth.logout')} style={styles.actionBtn}>&#x23FB;</button>
        </div>
      </div>

      {showInvite && community && (
        <InviteLinkModal
          communityId={community.id}
          communityName={community.name}
          onClose={() => setShowInvite(false)}
        />
      )}

      {showCreateChannel && communityId && (
        <CreateChannelModal
          communityId={communityId}
          onClose={() => setShowCreateChannel(false)}
        />
      )}

      {editingChannel && communityId && (
        <EditChannelModal
          communityId={communityId}
          channelId={editingChannel.id}
          currentName={editingChannel.name}
          currentVisibility={editingChannel.visibility}
          onClose={() => setEditingChannel(null)}
        />
      )}

      {showProfile && (
        <EditProfileModal onClose={() => setShowProfile(false)} />
      )}

      {showCreateSquad && communityId && (
        <CreateSquadModal communityId={communityId} onClose={() => setShowCreateSquad(false)} />
      )}
    </>
  );
}

const styles = {
  sidebar:      { width:'var(--sidebar-channels-w)', background:'var(--color-bg-secondary)', display:'flex', flexDirection:'column' as const, borderRight:'1px solid var(--color-border)', flexShrink:0 } as React.CSSProperties,
  header:       { padding:'14px 14px 10px', borderBottom:'1px solid var(--color-border)', display:'flex', alignItems:'center', justifyContent:'space-between' } as React.CSSProperties,
  serverName:   { fontSize:'14px', fontWeight:600, letterSpacing:'0.02em', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const } as React.CSSProperties,
  peerBadge:    { fontSize:'10px', fontFamily:'var(--font-mono)', background:'var(--color-accent-dim)', color:'var(--color-accent)', padding:'2px 6px', borderRadius:'4px', border:'1px solid var(--color-accent-border)', flexShrink:0 } as React.CSSProperties,
  inviteBtn:    { width:'22px', height:'22px', borderRadius:'50%', background:'var(--color-accent-dim)', border:'1px solid var(--color-accent-border)', color:'var(--color-accent)', cursor:'pointer', fontSize:'16px', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 } as React.CSSProperties,
  list:         { flex:1, overflowY:'auto' as const, padding:'8px 0' } as React.CSSProperties,
  sectionRow:   { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 14px 4px' } as React.CSSProperties,
  sectionLabel: { fontSize:'10px', fontWeight:600, color:'var(--color-text-muted)', letterSpacing:'0.1em', textTransform:'uppercase' as const } as React.CSSProperties,
  createChannelBtn: { width:'16px', height:'16px', borderRadius:'3px', background:'transparent', border:'none', color:'var(--color-text-muted)', cursor:'pointer', fontSize:'14px', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'color 0.15s' } as React.CSSProperties,
  channelItem:  { display:'flex', alignItems:'center', gap:'6px', padding:'5px 14px', width:'100%', background:'transparent', border:'none', cursor:'pointer', color:'var(--color-text-muted)', textAlign:'left' as const, transition:'background 0.1s, color 0.1s' } as React.CSSProperties,
  channelActive:{ background:'var(--color-bg-hover)', color:'var(--color-text-primary)' } as React.CSSProperties,
  chIcon:       { width:'16px', textAlign:'center' as const, fontSize:'13px', flexShrink:0, fontFamily:'var(--font-mono)', color:'var(--color-text-muted)' } as React.CSSProperties,
  chName:       { fontSize:'13px', flex:1 } as React.CSSProperties,
  visibilityBadge: { fontSize:'10px', flexShrink:0, opacity:0.6 } as React.CSSProperties,
  syncing:      { fontSize:'12px', color:'var(--color-text-muted)', padding:'12px 14px', fontStyle:'italic' as const } as React.CSSProperties,
  emptyState:   { fontSize:'12px', color:'var(--color-text-muted)', padding:'12px 14px', lineHeight:1.6 } as React.CSSProperties,
  userPanel:    { padding:'8px 10px', background:'var(--color-bg-tertiary)', borderTop:'1px solid var(--color-border)', display:'flex', alignItems:'center', gap:'8px' } as React.CSSProperties,
  avatar:       { width:'32px', height:'32px', borderRadius:'50%', background:'var(--color-accent-dim)', border:'1.5px solid var(--color-accent)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'12px', fontWeight:600, color:'var(--color-accent)', flexShrink:0 } as React.CSSProperties,
  userInfo:     { flex:1, overflow:'hidden' } as React.CSSProperties,
  actionBtn:    { width:'26px', height:'26px', borderRadius:'6px', background:'transparent', border:'1px solid var(--color-border)', color:'var(--color-text-muted)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'14px', flexShrink:0 } as React.CSSProperties,
} as const;
