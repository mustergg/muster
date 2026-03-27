import React, { useState, useEffect } from 'react';
import GuildsSidebar from '../components/GuildsSidebar.js';
import ChannelsSidebar from '../components/ChannelsSidebar.js';
import ChatArea from '../components/ChatArea.js';
import MembersSidebar from '../components/MembersSidebar.js';
import { useNetworkStore } from '../stores/networkStore.js';
import { useCommunityStore } from '../stores/communityStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { useChatStore } from '../stores/chatStore.js';

export interface ActiveLocation {
  communityId: string;
  channelId: string;
  channelName: string;
}

export default function MainLayout(): React.JSX.Element {
  const [active, setActive]                   = useState<ActiveLocation | null>(null);
  const [activeCommunityId, setActiveCommunityId] = useState<string | null>(null);
  const { connect, status }   = useNetworkStore();
  const { loadCommunities }   = useCommunityStore();

  // Auto-connect only if user is already authenticated (e.g. returning session)
  const { isAuthenticated } = useAuthStore();
  useEffect(() => {
    if (status === 'disconnected' && isAuthenticated) {
      connect().catch((err: unknown) => {
        console.warn('[Network] Auto-connect failed:', err);
      });
    }
  }, [isAuthenticated]);

  // Initialize chat and community message handlers when connected
  const chatInit = useChatStore((s) => s.init);
  const communityInit = useCommunityStore((s) => s.initRelay);
  useEffect(() => {
    if (status === 'connected') {
      const chatCleanup = chatInit();
      const communityCleanup = communityInit();

      // Load communities from relay (and localStorage cache)
      loadCommunities();

      return () => {
        chatCleanup();
        communityCleanup();
      };
    }
  }, [status]);

  return (
    <div style={styles.shell}>
      <GuildsSidebar
        activeCommunityId={activeCommunityId}
        onSelectCommunity={setActiveCommunityId}
      />
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
      <MembersSidebar communityId={activeCommunityId} />
    </div>
  );
}

const styles = {
  shell: { flex:1, display:'flex', overflow:'hidden', minHeight:0 } as React.CSSProperties,
  main:  { flex:1, display:'flex', flexDirection:'column' as const, minWidth:0, overflow:'hidden' } as React.CSSProperties,
} as const;
