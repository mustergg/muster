import React, { useState, useEffect, useRef } from 'react';
import GuildsSidebar from '../components/GuildsSidebar.js';
import ChannelsSidebar from '../components/ChannelsSidebar.js';
import MembersSidebar from '../components/MembersSidebar.js';
import DMConversationList from '../components/DMConversationList.js';
import SquadSidebar from '../components/SquadSidebar.js';
import MainContent from '../components/MainContent.js';
import MobileShell from '../components/MobileShell.js';
import NotifSettingsModal from '../components/NotifSettingsModal.js';
import { useIsMobile } from '../lib/useResponsive.js';
import { useChatPrefs } from '../stores/chatPrefsStore.js';
import { useUserStatus } from '../stores/userStatusStore.js';
import { useUiNav } from '../stores/uiNavStore.js';
import type { SquadRoom } from '../stores/squadStore.js';
import type { ActiveLocation, ViewMode } from '../components/layoutTypes.js';
import VerificationBanner from '../components/VerificationBanner.js';
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
import { useReadReceiptStore } from '../stores/readReceiptStore.js';
import { useStatusStore } from '../stores/statusStore.js';
import { useNotify } from '../stores/notifyStore.js';
// clientNodeStore is imported dynamically (only registers global, no init needed)
import '../stores/clientNodeStore.js';
import { useNatStore } from '../stores/natStore.js';

export type { ActiveLocation };

/** Pick which channel to auto-open when a community is selected:
 *  most-recently-active unread channel → last-viewed channel → first text/feed.
 *  "unread" is proxied by per-channel activity newer than the last open.
 *  Returns null when the community's channels haven't loaded yet. */
function resolveCommunityEntry(communityId: string): ActiveLocation | null {
  const community = useCommunityStore.getState().communities[communityId];
  const channels = (community?.channels ?? []) as Array<{ id: string; name: string; type?: string }>;
  if (!channels.length) return null;
  const { activity, lastUsed } = useChatPrefs.getState();
  const unread = channels.filter((ch) => (activity[ch.id] ?? 0) > (lastUsed[ch.id] ?? 0));
  if (unread.length) {
    const best = unread.reduce((a, b) => ((activity[b.id] ?? 0) > (activity[a.id] ?? 0) ? b : a));
    return { communityId, channelId: best.id, channelName: best.name };
  }
  const viewed = channels.filter((ch) => (lastUsed[ch.id] ?? 0) > 0);
  if (viewed.length) {
    const best = viewed.reduce((a, b) => ((lastUsed[b.id] ?? 0) > (lastUsed[a.id] ?? 0) ? b : a));
    return { communityId, channelId: best.id, channelName: best.name };
  }
  const first = channels.find((c) => c.type === 'text' || c.type === 'feed') ?? channels[0]!;
  return { communityId, channelId: first.id, channelName: first.name };
}

/** Squad-in-community entry: reopen the last-viewed room (text/voice), default text. */
function resolveSquadEntry(communityId: string, squadId: string, name: string): ActiveLocation {
  const { lastUsed } = useChatPrefs.getState();
  const tKey = `__squad_text__${squadId}`;
  const vKey = `__squad_voice__${squadId}`;
  const voice = (lastUsed[vKey] ?? 0) > (lastUsed[tKey] ?? 0);
  return { communityId, channelId: voice ? vKey : tKey, channelName: voice ? `${name} Voice` : name };
}

export default function MainLayout(): React.JSX.Element {
  const [viewMode, setViewMode] = useState<ViewMode>('community');
  const [active, setActive]                       = useState<ActiveLocation | null>(null);
  const [activeSquad, setActiveSquad]             = useState<string | null>(null);
  const [squadMode, setSquadMode]                 = useState<SquadRoom>('text');
  const [activeCommunityId, setActiveCommunityId] = useState<string | null>(null);
  const [activeDMPartner, setActiveDMPartner]     = useState<string | null>(null);
  const { connect, status }   = useNetworkStore();
  const { loadCommunities, communities } = useCommunityStore();
  const isMobile = useIsMobile();

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
      const c14 = useReadReceiptStore.getState().init();
      const c15 = useStatusStore.getState().init();
      const c16 = useChatPrefs.getState().init();
      const c17 = useUserStatus.getState().init();
      const c18 = useNotify.getState().init();
      loadCommunities();
      // Load top-level squads (personal + community) for the guild bar.
      setTimeout(() => useSquadStore.getState().loadMySquads(), 400);
      return () => { c1(); c2(); c3(); c4(); c5(); c6(); c7(); c8(); c9(); c10(); c11(); c12(); c13(); c14(); c15(); c16(); c17(); c18(); };
    }
    return undefined;
  }, [status]);

  useEffect(() => { loadCommunities(); }, []);

  // Remember the last non-settings view so closing settings returns there.
  const prevViewRef = useRef<ViewMode>('community');
  useEffect(() => {
    if (viewMode !== 'settings') prevViewRef.current = viewMode;
    useUiNav.getState().setSettingsOpen(viewMode === 'settings');
  }, [viewMode]);

  // Bridge the shared UserPanel / SettingsPanel to open & close settings.
  useEffect(() => {
    useUiNav.getState().setOpenSettings(() => handleSelectSettings());
    useUiNav.getState().setCloseSettings(() => setViewMode(prevViewRef.current));
    return () => { useUiNav.getState().setOpenSettings(null); useUiNav.getState().setCloseSettings(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // R25 — Phase 4. Browser piece cache for blob attachments. Init once;
  // shut down on unmount.
  useEffect(() => {
    usePieceCacheStore.getState().init();
    return () => usePieceCacheStore.getState().shutdown();
  }, []);

  // Set the active channel and record the open (drives last-viewed ordering and
  // the unread proxy). Pass null to clear (e.g. switching to a fresh community).
  const openChannel = (loc: ActiveLocation | null): void => {
    setActive(loc);
    if (loc) useChatPrefs.getState().touch(loc.channelId);
  };

  const handleOpenDM = (publicKey: string, username?: string) => { useDMStore.getState().openConversation(publicKey, username); setViewMode('dm'); setActiveDMPartner(publicKey); setActiveSquad(null); };
  const handleSelectDM = () => { setViewMode('dm'); setActiveCommunityId(null); setActive(null); setActiveSquad(null); };
  const handleSelectFriends = () => { setViewMode('friends'); setActiveCommunityId(null); setActive(null); setActiveDMPartner(null); setActiveSquad(null); };
  const handleSelectCommunity = (id: string) => { setViewMode('community'); setActiveCommunityId(id); setActiveDMPartner(null); setActiveSquad(null); openChannel(resolveCommunityEntry(id)); };
  const handleSelectSettings = () => { setViewMode('settings'); setActiveCommunityId(null); setActive(null); setActiveDMPartner(null); setActiveSquad(null); };
  const handleSelectSquad = (squadId: string) => {
    const squad = useSquadStore.getState().allMySquads().find((s) => s.id === squadId);
    const cid = squad?.communityId || '';
    // Member of the parent community? Only members get the in-community view
    // with its channels. Squad-only users (and personal squads) get the
    // standalone squad view — they see just the squad until they choose to join.
    const isCommunityMember = !!cid && !cid.startsWith('personal:') && !!useCommunityStore.getState().communities[cid];
    setActiveDMPartner(null);
    if (cid && !cid.startsWith('personal:') && isCommunityMember) {
      setViewMode('community');
      setActiveCommunityId(cid);
      setActiveSquad(null);
      openChannel(resolveSquadEntry(cid, squadId, squad?.name || 'Squad'));
    } else {
      setViewMode('squad');
      setActiveSquad(squadId);
      setSquadMode('text');
      setActiveCommunityId(null);
      setActive(null);
    }
    useSquadStore.getState().openSquad(squadId);
  };

  // Entering a community auto-opens a channel. Resolve here so it also works
  // when channels arrive after selection (async COMMUNITY_DATA), and so a stale
  // selection left over from another group (e.g. a squad's text channel) is
  // replaced instead of lingering when switching communities.
  useEffect(() => {
    if (viewMode !== 'community' || !activeCommunityId) return;
    if (active && active.communityId === activeCommunityId) return; // already on this community
    const entry = resolveCommunityEntry(activeCommunityId);
    if (entry) openChannel(entry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, activeCommunityId, communities]);

  // Keep chatStore's active channel in sync so messages arriving for the channel
  // on screen are marked read live (no lingering unread badge for what you view).
  useEffect(() => {
    useChatStore.getState().setActiveChannel(active?.channelId ?? null);
  }, [active]);

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

  if (isMobile) {
    return (
      <div style={styles.outerShell}>
        <VerificationBanner />
        <NotifSettingsModal />
        <MobileShell
          viewMode={viewMode}
          active={active}
          activeSquad={activeSquad}
          squadMode={squadMode}
          activeCommunityId={activeCommunityId}
          activeDMPartner={activeDMPartner}
          onSelectCommunity={handleSelectCommunity}
          onSelectDM={handleSelectDM}
          onSelectFriends={handleSelectFriends}
          onSelectSettings={handleSelectSettings}
          onSelectSquad={handleSelectSquad}
          onSelectChannel={(communityId, channelId, channelName) => openChannel({ communityId, channelId, channelName })}
          onSelectDMPartner={(pk) => setActiveDMPartner(pk)}
          onSelectSquadMode={setSquadMode}
          onOpenDM={handleOpenDM}
        />
      </div>
    );
  }

  const mainContent = (
    <MainContent
      viewMode={viewMode}
      active={active}
      activeSquad={activeSquad}
      squadMode={squadMode}
      activeCommunityId={activeCommunityId}
      activeDMPartner={activeDMPartner}
      onOpenDM={handleOpenDM}
    />
  );

  return (
    <div style={styles.outerShell}>
      <VerificationBanner />
      <NotifSettingsModal />

      <div style={styles.shell}>
        <GuildsSidebar
          activeCommunityId={activeCommunityId}
          onSelectCommunity={handleSelectCommunity}
          dmActive={viewMode === 'dm'}
          onSelectDM={handleSelectDM}
          activeDMPartner={activeDMPartner}
          onOpenDM={handleOpenDM}
          friendsActive={viewMode === 'friends'}
          onSelectFriends={handleSelectFriends}
          settingsActive={viewMode === 'settings'}
          onSelectSettings={handleSelectSettings}
          activeSquadId={activeSquad ?? (active?.channelId?.match(/^__squad_(?:text|voice)__(.+)$/)?.[1] ?? null)}
          onSelectSquad={handleSelectSquad}
        />

        {viewMode === 'settings' ? (
          mainContent
        ) : viewMode === 'squad' && activeSquad ? (
          <>
            <SquadSidebar squadId={activeSquad} activeMode={squadMode} onSelectMode={setSquadMode} onJoinCommunity={handleSelectCommunity} onOpenDM={handleOpenDM} />
            <div style={styles.main}>{mainContent}</div>
          </>
        ) : viewMode === 'friends' ? (
          <div style={styles.main}>{mainContent}</div>
        ) : viewMode === 'dm' ? (
          <>
            <DMConversationList
              activeConversation={activeDMPartner}
              onSelectConversation={(pk) => setActiveDMPartner(pk)}
            />
            <div style={styles.main}>{mainContent}</div>
          </>
        ) : (
          <>
            <ChannelsSidebar
              communityId={activeCommunityId}
              activeChannelId={active?.channelId ?? null}
              onSelectChannel={(communityId, channelId, channelName) =>
                openChannel({ communityId, channelId, channelName })
              }
            />
            <div style={styles.main}>{mainContent}</div>
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
