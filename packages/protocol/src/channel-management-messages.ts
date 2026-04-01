/**
 * Channel Management Protocol Messages — R7
 *
 * ADD THIS FILE to packages/protocol/src/ and re-export from index.ts:
 *   export * from './channel-management-messages.js';
 */

// =================================================================
// Channel Management: Client → Relay
// =================================================================

/** Create a new channel in a community. Requires admin+ role. */
export interface CreateChannelMsg {
  type: 'CREATE_CHANNEL';
  payload: {
    communityId: string;
    name: string;
    type?: 'text' | 'feed' | 'voice' | 'voice-temp';
    visibility?: 'public' | 'private' | 'readonly' | 'archived';
  };
  timestamp: number;
}

/** Edit an existing channel (rename, change visibility). Requires admin+ role. */
export interface EditChannelMsg {
  type: 'EDIT_CHANNEL';
  payload: {
    communityId: string;
    channelId: string;
    name?: string;
    visibility?: 'public' | 'private' | 'readonly' | 'archived';
  };
  timestamp: number;
}

/** Delete a channel. Requires admin+ role. Cannot delete the last channel. */
export interface DeleteChannelMsg {
  type: 'DELETE_CHANNEL_CMD';
  payload: {
    communityId: string;
    channelId: string;
  };
  timestamp: number;
}

/** Reorder channels in a community. Requires admin+ role. */
export interface ReorderChannelsMsg {
  type: 'REORDER_CHANNELS';
  payload: {
    communityId: string;
    /** Ordered array of channel IDs — position is derived from index. */
    channelIds: string[];
  };
  timestamp: number;
}

// =================================================================
// Channel Management: Relay → Client(s)
// =================================================================

/** A new channel was created. Sent to all community members. */
export interface ChannelCreatedMsg {
  type: 'CHANNEL_CREATED';
  payload: {
    communityId: string;
    channel: {
      id: string;
      name: string;
      type: string;
      visibility: string;
      position: number;
    };
    createdBy: string;
  };
  timestamp: number;
}

/** A channel was updated. Sent to all community members. */
export interface ChannelUpdatedMsg {
  type: 'CHANNEL_UPDATED';
  payload: {
    communityId: string;
    channel: {
      id: string;
      name: string;
      type: string;
      visibility: string;
      position: number;
    };
    updatedBy: string;
  };
  timestamp: number;
}

/** A channel was deleted. Sent to all community members. */
export interface ChannelDeletedMsg {
  type: 'CHANNEL_DELETED_EVENT';
  payload: {
    communityId: string;
    channelId: string;
    deletedBy: string;
  };
  timestamp: number;
}

/** Channels were reordered. Sent to all community members. */
export interface ChannelsReorderedMsg {
  type: 'CHANNELS_REORDERED';
  payload: {
    communityId: string;
    channels: Array<{
      id: string;
      name: string;
      type: string;
      visibility: string;
      position: number;
    }>;
  };
  timestamp: number;
}
