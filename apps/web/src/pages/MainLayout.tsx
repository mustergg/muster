/**
 * Main application layout — shown when the user is authenticated.
 * Renders the three-column shell: guilds | channels | chat + members.
 */

import React, { useState } from 'react';
import GuildsSidebar from '../components/GuildsSidebar.js';
import ChannelsSidebar from '../components/ChannelsSidebar.js';
import ChatArea from '../components/ChatArea.js';
import MembersSidebar from '../components/MembersSidebar.js';

export interface ActiveLocation {
  communityId: string;
  channelId: string;
  channelName: string;
}

export default function MainLayout(): React.JSX.Element {
  const [active, setActive] = useState<ActiveLocation | null>(null);
  const [activeCommunityId, setActiveCommunityId] = useState<string | null>(null);

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
  shell: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    minHeight: 0,
  } as React.CSSProperties,

  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    minWidth: 0,
    overflow: 'hidden',
  } as React.CSSProperties,
} as const;
