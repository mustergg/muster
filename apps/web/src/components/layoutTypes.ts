/** Shared layout types used by MainLayout, MainContent and MobileShell. */

export interface ActiveLocation {
  communityId: string;
  channelId: string;
  channelName: string;
}

export type ViewMode = 'community' | 'dm' | 'friends' | 'settings' | 'squad';
