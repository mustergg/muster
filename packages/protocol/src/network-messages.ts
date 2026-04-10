/**
 * Network / PEX Protocol Messages — R15
 *
 * Messages for node-to-node communication, peer discovery,
 * and community replication.
 *
 * ADD to packages/protocol/src/ and re-export from index.ts:
 *   export * from './network-messages.js';
 */

// =================================================================
// Node identity
// =================================================================

export interface NodeInfo {
  nodeId: string;
  url: string;
  name: string;
  /** Number of communities hosted on this node */
  communityCount: number;
  /** Number of connected users */
  userCount: number;
  /** Milliseconds since node started */
  uptime: number;
  /** When this node info was last updated */
  lastSeen: number;
}

// =================================================================
// Client → Relay
// =================================================================

/** Request the list of known nodes in the network. */
export interface GetNodesMsg {
  type: 'GET_NODES';
  payload: {};
  timestamp: number;
}

// =================================================================
// Relay → Client
// =================================================================

/** List of known nodes in the network. */
export interface NodeListMsg {
  type: 'NODE_LIST';
  payload: { nodes: NodeInfo[] };
  timestamp: number;
}

// =================================================================
// Relay ↔ Relay (node-to-node protocol)
// =================================================================

/** Relay identifies itself to a peer relay. */
export interface NodeHandshakeMsg {
  type: 'NODE_HANDSHAKE';
  payload: {
    nodeId: string;
    url: string;
    name: string;
    communityIds: string[];
    version: string;
  };
  timestamp: number;
}

/** Response to handshake — accepted. */
export interface NodeHandshakeAckMsg {
  type: 'NODE_HANDSHAKE_ACK';
  payload: {
    nodeId: string;
    url: string;
    name: string;
    communityIds: string[];
    version: string;
  };
  timestamp: number;
}

/** Peer Exchange — share known peers. */
export interface PexShareMsg {
  type: 'PEX_SHARE';
  payload: {
    peers: Array<{ nodeId: string; url: string; lastSeen: number }>;
  };
  timestamp: number;
}

/** Request sync of messages for a community since a given timestamp. */
export interface NodeSyncRequestMsg {
  type: 'NODE_SYNC_REQUEST';
  payload: {
    communityId: string;
    /** Sync messages after this timestamp */
    since: number;
    /** Requesting node's ID */
    requestingNodeId: string;
  };
  timestamp: number;
}

/** Batch of messages sent in response to a sync request. */
export interface NodeSyncResponseMsg {
  type: 'NODE_SYNC_RESPONSE';
  payload: {
    communityId: string;
    messages: Array<{
      messageId: string;
      channel: string;
      content: string;
      senderPublicKey: string;
      senderUsername: string;
      timestamp: number;
      signature: string;
    }>;
    /** True if there are more messages to sync */
    hasMore: boolean;
  };
  timestamp: number;
}

/** Forward a new message to peer nodes for replication. */
export interface MessageForwardMsg {
  type: 'MESSAGE_FORWARD';
  payload: {
    sourceNodeId: string;
    communityId: string;
    message: {
      messageId: string;
      channel: string;
      content: string;
      senderPublicKey: string;
      senderUsername: string;
      timestamp: number;
      signature: string;
    };
  };
  timestamp: number;
}

/** Forward a new DM to peer nodes for replication. */
export interface DMForwardMsg {
  type: 'DM_FORWARD';
  payload: {
    sourceNodeId: string;
    dm: {
      messageId: string;
      senderPublicKey: string;
      senderUsername: string;
      recipientPublicKey: string;
      content: string;
      timestamp: number;
      signature: string;
    };
  };
  timestamp: number;
}
