/**
 * MainContent — the shared center panel switch used by both the desktop
 * layout (MainLayout) and the mobile shell (MobileShell). Renders only the
 * main content for the active view (chat / feed / voice / DM / friends /
 * settings / squad); sidebars and drawers live in the respective shells.
 *
 * Keeping this in one place means the desktop and mobile layouts can never
 * drift on which panel is shown for a given selection.
 */
import React from 'react';
import ChatArea from './ChatArea.js';
import DMChatArea from './DMChatArea.js';
import FriendsPanel from './FriendsPanel.js';
import FeedView from './FeedView.js';
import SquadChatArea from './SquadChatArea.js';
import VoicePanel from './VoicePanel.js';
import SettingsPanel from './SettingsPanel.js';
import { useCommunityStore } from '../stores/communityStore.js';
import type { ActiveLocation } from './layoutTypes.js';
import type { SquadRoom } from '../stores/squadStore.js';

interface Props {
  viewMode: 'community' | 'dm' | 'friends' | 'settings' | 'squad';
  active: ActiveLocation | null;
  activeSquad: string | null;
  squadMode: SquadRoom;
  activeCommunityId: string | null;
  activeDMPartner: string | null;
  onOpenDM: (publicKey: string) => void;
}

export default function MainContent({
  viewMode, active, activeSquad, squadMode, activeCommunityId, activeDMPartner, onOpenDM,
}: Props): React.JSX.Element {
  const communities = useCommunityStore((s) => s.communities);

  if (viewMode === 'settings') return <SettingsPanel />;
  if (viewMode === 'friends') return <FriendsPanel onOpenDM={onOpenDM} />;
  if (viewMode === 'dm') return <DMChatArea partnerPublicKey={activeDMPartner} />;
  if (viewMode === 'squad' && activeSquad) return <SquadChatArea squadId={activeSquad} mode={squadMode} />;

  // community view — resolve the special channel kinds the same way the
  // desktop layout does.
  const isFeed = active?.channelId === '__feed__';
  const squadText = active?.channelId?.match(/^__squad_text__(.+)$/);
  const squadVoice = active?.channelId?.match(/^__squad_voice__(.+)$/);
  const activeCommunity = activeCommunityId ? communities[activeCommunityId] : null;
  const chData = activeCommunity?.channels?.find((c: any) => c.id === active?.channelId);
  const isVoice = chData?.type === 'voice' || chData?.type === 'voice-temp';

  if (isFeed && active) return <FeedView communityId={active.communityId} />;
  if (squadText) return <SquadChatArea squadId={squadText[1]!} mode="text" />;
  if (squadVoice) return <SquadChatArea squadId={squadVoice[1]!} mode="voice" />;
  if (isVoice && active) {
    return (
      <div style={styles.voiceStack}>
        <div style={styles.voiceRegion}>
          <VoicePanel channelId={active.channelId} channelName={active.channelName} />
        </div>
        <div style={styles.voiceTextRegion}>
          <ChatArea active={active} />
        </div>
      </div>
    );
  }
  return <ChatArea active={active} />;
}

const styles = {
  voiceStack: { flex: 1, display: 'flex', flexDirection: 'column' as const, minHeight: 0, overflow: 'hidden' } as React.CSSProperties,
  voiceRegion: { flex: '0 0 45%', minHeight: 0, borderBottom: '1px solid var(--color-border)', overflow: 'hidden' } as React.CSSProperties,
  voiceTextRegion: { flex: '1 1 55%', minHeight: 0, display: 'flex', overflow: 'hidden' } as React.CSSProperties,
} as const;
