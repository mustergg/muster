import React, { useState, useEffect } from 'react';
import GuildsSidebar from '../components/GuildsSidebar.js';
import ChannelsSidebar from '../components/ChannelsSidebar.js';
import ChatArea from '../components/ChatArea.js';
import MembersSidebar from '../components/MembersSidebar.js';
import DMConversationList from '../components/DMConversationList.js';
import DMChatArea from '../components/DMChatArea.js';
import VerificationBanner from '../components/VerificationBanner.js';
import { useNetworkStore } from '../stores/networkStore.js';
import { useCommunityStore } from '../stores/communityStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { useChatStore } from '../stores/chatStore.js';
import { useDMStore } from '../stores/dmStore.js';

export interface ActiveLocation {
  communityId: string;
  channelId: string;
  channelName: string;
}

type ViewMode = 'community' | 'dm';

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
  useEffect(() => {
    if (status === 'connected') {
      const c1 = chatInit();
      const c2 = communityInit();
      const c3 = dmInit();
      loadCommunities();
      return () => { c1(); c2(); c3(); };
    }
  }, [status]);

  useEffect(() => { loadCommunities(); }, []);

  const handleOpenDM = (publicKey: string) => { setViewMode('dm'); setActiveDMPartner(publicKey); };
  const handleSelectDM = () => { setViewMode('dm'); setActiveCommunityId(null); setActive(null); };
  const handleSelectCommunity = (id: string) => { setViewMode('community'); setActiveCommunityId(id); setActiveDMPartner(null); };

  return (
    <div style={styles.outerShell}>
      {/* Verification banner for basic users — above everything */}
      <VerificationBanner />

      <div style={styles.shell}>
        <GuildsSidebar
          activeCommunityId={activeCommunityId}
          onSelectCommunity={handleSelectCommunity}
          dmActive={viewMode === 'dm'}
          onSelectDM={handleSelectDM}
        />

        {viewMode === 'dm' ? (
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
              <ChatArea active={active} />
            </div>
            <MembersSidebar communityId={activeCommunityId} onOpenDM={handleOpenDM} />
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
