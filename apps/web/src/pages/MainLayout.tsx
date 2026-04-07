import React, { useState, useEffect } from 'react';
import GuildsSidebar from '../components/GuildsSidebar.js';
import ChannelsSidebar from '../components/ChannelsSidebar.js';
import ChatArea from '../components/ChatArea.js';
import MembersSidebar from '../components/MembersSidebar.js';
import DMConversationList from '../components/DMConversationList.js';
import DMChatArea from '../components/DMChatArea.js';
import FriendsPanel from '../components/FriendsPanel.js';
import FeedView from '../components/FeedView.js';
import SquadChatArea from '../components/SquadChatArea.js';
import VerificationBanner from '../components/VerificationBanner.js';
import { useNetworkStore } from '../stores/networkStore.js';
import { useCommunityStore } from '../stores/communityStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { useChatStore } from '../stores/chatStore.js';
import { useDMStore } from '../stores/dmStore.js';
import { useFriendStore } from '../stores/friendStore.js';
import { usePostStore } from '../stores/postStore.js';
import { useSquadStore } from '../stores/squadStore.js';

export interface ActiveLocation {
  communityId: string;
  channelId: string;
  channelName: string;
}

type ViewMode = 'community' | 'dm' | 'friends';

export default function MainLayout(): React.JSX.Element {
  const [viewMode, setViewMode] = useState<ViewMode>('community');
  const [active, setActive]                       = useState<ActiveLocation | null>(null);
  const [activeCommunityId, setActiveCommunityId] = useState<string | null>(null);
  const [activeDMPartner, setActiveDMPartner]     = useState<string | null>(null);
  const { connect, status }   = useNetworkStore();
  const { loadCommunities }   = useCommunityStore();

  const { isAuthenticated } = useAuthStore();
  useEffect(() => {
    if (status === 'disconnected' && isAuthenticated) {
      connect().catch((err: unknown) => { console.warn('[Network] Auto-connect failed:', err); });
    }
  }, [isAuthenticated]);

  const chatInit      = useChatStore((s) => s.init);
  const communityInit = useCommunityStore((s) => s.initRelay);
  const dmInit        = useDMStore((s) => s.init);
  const friendInit    = useFriendStore((s) => s.init);
  const postInit      = usePostStore((s) => s.init);
  const squadInit     = useSquadStore((s) => s.init);
  useEffect(() => {
    if (status === 'connected') {
      const c1 = chatInit();
      const c2 = communityInit();
      const c3 = dmInit();
      const c4 = friendInit();
      const c5 = postInit();
      const c6 = squadInit();
      loadCommunities();
      return () => { c1(); c2(); c3(); c4(); c5(); c6(); };
    }
    return undefined;
  }, [status]);

  useEffect(() => { loadCommunities(); }, []);

  const handleOpenDM = (publicKey: string) => { setViewMode('dm'); setActiveDMPartner(publicKey); };
  const handleSelectDM = () => { setViewMode('dm'); setActiveCommunityId(null); setActive(null); };
  const handleSelectFriends = () => { setViewMode('friends'); setActiveCommunityId(null); setActive(null); setActiveDMPartner(null); };
  const handleSelectCommunity = (id: string) => { setViewMode('community'); setActiveCommunityId(id); setActiveDMPartner(null); };

  // Determine what's active in the main area
  const isFeedActive = active?.channelId === '__feed__';
  const squadTextMatch = active?.channelId?.match(/^__squad_text__(.+)$/);
  const squadVoiceMatch = active?.channelId?.match(/^__squad_voice__(.+)$/);
  const isSquadText = !!squadTextMatch;
  const isSquadVoice = !!squadVoiceMatch;
  const activeSquadId = squadTextMatch?.[1] || squadVoiceMatch?.[1] || null;
  const isSpecialView = isFeedActive || isSquadText || isSquadVoice;

  return (
    <div style={styles.outerShell}>
      <VerificationBanner />

      <div style={styles.shell}>
        <GuildsSidebar
          activeCommunityId={activeCommunityId}
          onSelectCommunity={handleSelectCommunity}
          dmActive={viewMode === 'dm'}
          onSelectDM={handleSelectDM}
          friendsActive={viewMode === 'friends'}
          onSelectFriends={handleSelectFriends}
        />

        {viewMode === 'friends' ? (
          <div style={styles.main}>
            <FriendsPanel />
          </div>
        ) : viewMode === 'dm' ? (
          <>
            <DMConversationList
              activeConversation={activeDMPartner}
              onSelectConversation={(pk) => setActiveDMPartner(pk)}
            />
            <div style={styles.main}>
              <DMChatArea partnerPublicKey={activeDMPartner} />
            </div>
          </>
        ) : (
          <>
            <ChannelsSidebar
              communityId={activeCommunityId}
              activeChannelId={active?.channelId ?? null}
              onSelectChannel={(communityId, channelId, channelName) =>
                setActive({ communityId, channelId, channelName })
              }
            />
            <div style={styles.main}>
              {isFeedActive && active ? (
                <FeedView communityId={active.communityId} />
              ) : isSquadText && activeSquadId ? (
                <SquadChatArea squadId={activeSquadId} mode="text" />
              ) : isSquadVoice && activeSquadId ? (
                <SquadChatArea squadId={activeSquadId} mode="voice" />
              ) : (
                <ChatArea active={active} />
              )}
            </div>
            {!isSpecialView && (
              <MembersSidebar communityId={activeCommunityId} onOpenDM={handleOpenDM} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  outerShell: { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minHeight: 0 } as React.CSSProperties,
  shell: { flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 } as React.CSSProperties,
  main: { flex: 1, display: 'flex', flexDirection: 'column' as const, minWidth: 0, overflow: 'hidden' } as React.CSSProperties,
} as const;
