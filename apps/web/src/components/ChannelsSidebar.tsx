import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/authStore.js';
import { useNetworkStore } from '../stores/networkStore.js';
import { useCommunityStore } from '../stores/communityStore.js';
import InviteLinkModal from '../pages/InviteLinkModal.js';

interface Props {
  communityId: string | null;
  activeChannelId: string | null;
  onSelectChannel: (communityId: string, channelId: string, channelName: string) => void;
}

export default function ChannelsSidebar({ communityId, activeChannelId, onSelectChannel }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { username, logout }              = useAuthStore();
  const { status, peerCount, peerId, disconnect } = useNetworkStore();
  const { communities, subscribePresence, onlineMembers, serveCommunityRequests } = useCommunityStore();
  const [showInvite, setShowInvite] = useState(false);

  const community = communityId ? communities[communityId] : null;
  const channels  = community?.channels ?? [];
  const textChannels  = channels.filter((c) => c.type === 'text' || c.type === 'feed');
  const voiceChannels = channels.filter((c) => c.type === 'voice' || c.type === 'voice-temp');
  const memberCount   = communityId ? (onlineMembers[communityId]?.length ?? 0) : 0;

  useEffect(() => {
    if (!communityId) return;
    const unsubPresence  = subscribePresence(communityId);
    const unsubRequests  = serveCommunityRequests(communityId);
    return () => { unsubPresence(); unsubRequests(); };
  }, [communityId]);

  const handleLogout = async (): Promise<void> => {
    await disconnect();
    logout();
  };

  return (
    <>
      <div style={styles.sidebar}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.serverName}>
            {community ? community.name : (communityId ? 'Loading…' : t('nav.communities'))}
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
            <div style={styles.syncing}>Syncing community…</div>
          )}

          {!communityId && (
            <div style={styles.emptyState}>
              Select or create a community to get started.
            </div>
          )}

          {textChannels.length > 0 && (
            <>
              <div style={styles.sectionLabel}>{t('community.channels')}</div>
              {textChannels.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => communityId && onSelectChannel(communityId, ch.id, ch.name)}
                  style={{ ...styles.channelItem, ...(activeChannelId === ch.id ? styles.channelActive : {}) }}
                >
                  <span style={styles.chIcon}>#</span>
                  <span style={styles.chName}>{ch.name}</span>
                </button>
              ))}
            </>
          )}

          {voiceChannels.length > 0 && (
            <>
              <div style={{ ...styles.sectionLabel, marginTop: '12px' }}>Voice</div>
              {voiceChannels.map((ch) => (
                <button key={ch.id} style={styles.channelItem}>
                  <span style={{ ...styles.chIcon, color: 'var(--color-green)' }}>◈</span>
                  <span style={styles.chName}>{ch.name}</span>
                </button>
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
              {peerId ? peerId.slice(0, 16) + '…' : 'not connected'}
            </div>
          </div>
          <button onClick={handleLogout} title={t('auth.logout')} style={styles.actionBtn}>⏻</button>
        </div>
      </div>

      {showInvite && community && (
        <InviteLinkModal
          communityId={community.id}
          communityName={community.name}
          onClose={() => setShowInvite(false)}
        />
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
  sectionLabel: { fontSize:'10px', fontWeight:600, color:'var(--color-text-muted)', letterSpacing:'0.1em', textTransform:'uppercase' as const, padding:'8px 14px 4px' } as React.CSSProperties,
  channelItem:  { display:'flex', alignItems:'center', gap:'6px', padding:'5px 14px', width:'100%', background:'transparent', border:'none', cursor:'pointer', color:'var(--color-text-muted)', textAlign:'left' as const, transition:'background 0.1s, color 0.1s' } as React.CSSProperties,
  channelActive:{ background:'var(--color-bg-hover)', color:'var(--color-text-primary)' } as React.CSSProperties,
  chIcon:       { width:'16px', textAlign:'center' as const, fontSize:'13px', flexShrink:0, fontFamily:'var(--font-mono)', color:'var(--color-text-muted)' } as React.CSSProperties,
  chName:       { fontSize:'13px', flex:1 } as React.CSSProperties,
  syncing:      { fontSize:'12px', color:'var(--color-text-muted)', padding:'12px 14px', fontStyle:'italic' as const } as React.CSSProperties,
  emptyState:   { fontSize:'12px', color:'var(--color-text-muted)', padding:'12px 14px', lineHeight:1.6 } as React.CSSProperties,
  userPanel:    { padding:'8px 10px', background:'var(--color-bg-tertiary)', borderTop:'1px solid var(--color-border)', display:'flex', alignItems:'center', gap:'8px' } as React.CSSProperties,
  avatar:       { width:'32px', height:'32px', borderRadius:'50%', background:'var(--color-accent-dim)', border:'1.5px solid var(--color-accent)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'12px', fontWeight:600, color:'var(--color-accent)', flexShrink:0 } as React.CSSProperties,
  userInfo:     { flex:1, overflow:'hidden' } as React.CSSProperties,
  actionBtn:    { width:'26px', height:'26px', borderRadius:'6px', background:'transparent', border:'1px solid var(--color-border)', color:'var(--color-text-muted)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'14px', flexShrink:0 } as React.CSSProperties,
} as const;
