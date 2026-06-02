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
import SettingsPanel from '../components/SettingsPanel.js';
import VoicePanel from '../components/VoicePanel.js';
import { useNetworkStore } from '../stores/networkStore.js';
import { useCommunityStore } from '../stores/communityStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { useChatStore } from '../stores/chatStore.js';
import { useDMStore } from '../stores/dmStore.js';
import { useFriendStore } from '../stores/friendStore.js';
import { usePostStore } from '../stores/postStore.js';
import { useSquadStore } from '../stores/squadStore.js';
import { useVoiceStore } from '../stores/voiceStore.js';
import { useStorageStore } from '../stores/storageStore.js';
import { useGroupCryptoStore } from '../stores/groupCryptoStore.js';
import { useManifestStore } from '../stores/manifestStore.js';
import { usePieceCacheStore } from '../stores/pieceCacheStore.js';
import { useBandwidthStore } from '../stores/bandwidthStore.js';
import { useReputationStore } from '../stores/reputationStore.js';
// clientNodeStore is imported dynamically (only registers global, no init needed)
import '../stores/clientNodeStore.js';
import { useNatStore } from '../stores/natStore.js';

export interface ActiveLocation {
  communityId: string;
  channelId: string;
  channelName: string;
}

type ViewMode = 'community' | 'dm' | 'friends' | 'settings' | 'squad';

export default function MainLayout(): React.JSX.Element {
  const [viewMode, setViewMode] = useState<ViewMode>('community');
  const [active, setActive]                       = useState<ActiveLocation | null>(null);
  const [activeSquad, setActiveSquad]             = useState<string | null>(null);
  const [activeCommunityId, setActiveCommunityId] = useState<string | null>(null);
  const [activeDMPartner, setActiveDMPartner]     = useState<string | null>(null);
  const { connect, status }   = useNetworkStore();
  const { loadCommunities, communities } = useCommunityStore();

  const { isAuthenticated } = useAuthStore();
  useEffect(() => {
    if (status === 'disconnected' && isAuthenticated) {
      connect().catch((err: unknown) => { console.warn('[Network] Auto-connect failed:', err); });
    }
  }, [isAuthenticated]);

  const chatInit        = useChatStore((s) => s.init);
  const communityInit   = useCommunityStore((s) => s.initRelay);
  const dmInit          = useDMStore((s) => s.init);
  const friendInit      = useFriendStore((s) => s.init);
  const postInit        = usePostStore((s) => s.init);
  const squadInit       = useSquadStore((s) => s.init);
  const voiceInit       = useVoiceStore((s) => s.init);
  const storageInit     = useStorageStore((s) => s.init);
  const groupCryptoInit = useGroupCryptoStore((s) => s.init);
  const natInit = useNatStore((s) => s.init);
  const manifestInit = useManifestStore((s) => s.init);
  const bandwidthInit = useBandwidthStore((s) => s.init);
  const reputationInit = useReputationStore((s) => s.init);


  useEffect(() => {
    if (status === 'connected') {
      const c1 = chatInit();
      const c2 = communityInit();
      const c3 = dmInit();
      const c4 = friendInit();
      const c5 = postInit();
      const c6 = squadInit();
      const c7 = voiceInit();
      const c8 = storageInit();
      const c9 = groupCryptoInit();
      const c10 = natInit();
      const c11 = manifestInit();
      const c12 = bandwidthInit();
      const c13 = reputationInit();
      loadCommunities();
      // Load top-level squads (personal + community) for the guild bar.
      setTimeout(() => useSquadStore.getState().loadMySquads(), 400);
      return () => { c1(); c2(); c3(); c4(); c5(); c6(); c7(); c8(); c9(); c10(); c11(); c12(); c13(); };
    }
    return undefined;
  }, [status]);

  useEffect(() => { loadCommunities(); }, []);

  // R25 — Phase 4. Browser piece cache for blob attachments. Init once;
  // shut down on unmount.
  useEffect(() => {
    usePieceCacheStore.getState().init();
    return () => usePieceCacheStore.getState().shutdown();
  }, []);

  const handleOpenDM = (publicKey: string) => { setViewMode('dm'); setActiveDMPartner(publicKey); setActiveSquad(null); };
  const handleSelectDM = () => { setViewMode('dm'); setActiveCommunityId(null); setActive(null); setActiveSquad(null); };
  const handleSelectFriends = () => { setViewMode('friends'); setActiveCommunityId(null); setActive(null); setActiveDMPartner(null); setActiveSquad(null); };
  const handleSelectCommunity = (id: string) => { setViewMode('community'); setActiveCommunityId(id); setActiveDMPartner(null); setActiveSquad(null); };
  const handleSelectSettings = () => { setViewMode('settings'); setActiveCommunityId(null); setActive(null); setActiveDMPartner(null); setActiveSquad(null); };
  const handleSelectSquad = (squadId: string) => {
    const squad = useSquadStore.getState().allMySquads().find((s) => s.id === squadId);
    const cid = squad?.communityId || '';
    setActiveDMPartner(null);
    // Community squad → open inside its community (sidebar + squad chat).
    // Personal/friends squad → standalone squad view.
    if (cid && !cid.startsWith('personal:')) {
      setViewMode('community');
      setActiveCommunityId(cid);
      setActiveSquad(null);
      setActive({ communityId: cid, channelId: `__squad_text__${squadId}`, channelName: squad?.name || 'Squad' });
    } else {
      setViewMode('squad');
      setActiveSquad(squadId);
      setActiveCommunityId(null);
      setActive(null);
    }
    useSquadStore.getState().openSquad(squadId);
  };

  // Determine what's active in the main area
  const isFeedActive = active?.channelId === '__feed__';
  const squadTextMatch = active?.channelId?.match(/^__squad_text__(.+)$/);
  const squadVoiceMatch = active?.channelId?.match(/^__squad_voice__(.+)$/);
  const isSquadText = !!squadTextMatch;
  const isSquadVoice = !!squadVoiceMatch;
  const activeSquadId = squadTextMatch?.[1] || squadVoiceMatch?.[1] || null;

  // R18: Detect community voice channels
  const activeCommunity = activeCommunityId ? communities[activeCommunityId] : null;
  const activeChannelData = activeCommunity?.channels?.find((ch: any) => ch.id === active?.channelId);
  const isCommunityVoice = activeChannelData?.type === 'voice' || activeChannelData?.type === 'voice-temp';

  const isSpecialView = isFeedActive || isSquadText || isSquadVoice || isCommunityVoice;

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
          settingsActive={viewMode === 'settings'}
          onSelectSettings={handleSelectSettings}
          activeSquadId={activeSquad ?? (active?.channelId?.match(/^__squad_(?:text|voice)__(.+)$/)?.[1] ?? null)}
          onSelectSquad={handleSelectSquad}
        />

        {viewMode === 'settings' ? (
          <SettingsPanel />
        ) : viewMode === 'squad' && activeSquad ? (
          <div style={styles.main}>
            <SquadChatArea squadId={activeSquad} mode="text" />
          </div>
        ) : viewMode === 'friends' ? (
          <div style={styles.main}>
            <FriendsPanel onOpenDM={handleOpenDM} />
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
              ) : isCommunityVoice && active ? (
                <div style={styles.voiceStack}>
                  <div style={styles.voiceRegion}>
                    <VoicePanel channelId={active.channelId} channelName={active.channelName} />
                  </div>
                  <div style={styles.voiceTextRegion}>
                    <ChatArea active={active} />
                  </div>
                </div>
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
  // Voice channel = voice panel (top) + its dedicated text chat (below).
  voiceStack: { flex: 1, display: 'flex', flexDirection: 'column' as const, minHeight: 0, overflow: 'hidden' } as React.CSSProperties,
  voiceRegion: { flex: '0 0 45%', minHeight: 0, borderBottom: '1px solid var(--color-border)', overflow: 'hidden' } as React.CSSProperties,
  voiceTextRegion: { flex: '1 1 55%', minHeight: 0, display: 'flex', overflow: 'hidden' } as React.CSSProperties,
} as const;
