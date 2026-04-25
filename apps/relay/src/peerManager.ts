/**
 * Peer Manager — R15
 *
 * Manages outbound WebSocket connections to peer relay nodes.
 * Handles PEX (peer exchange), message forwarding, and community replication.
 *
 * Architecture:
 * - This node connects to peers as a WebSocket CLIENT
 * - Peers can also connect to this node (handled in index.ts)
 * - Messages are forwarded to peers that host the same community
 * - PEX gossip spreads knowledge of the network
 */

import WebSocket from 'ws';
import { NodeDB } from './nodeDB';
import { RelayDB } from './database';
import { CommunityDB } from './communityDB';
import { DMDB } from './dmDB';
import { getCurrentVersion } from './nodeUpdater';

/** Default seed nodes for first boot. */
const SEED_NODES: Array<{ url: string; name: string }> = [
  // Add known seed nodes here. The RPi node is the first seed.
  // { url: 'ws://musternode.duckdns.org:4002', name: 'Muster Seed 1' },
];

/** How often to run PEX gossip (ms). */
const PEX_INTERVAL = 5 * 60 * 1000; // 5 minutes

/** How often to retry failed peer connections (ms). */
const RECONNECT_INTERVAL = 60 * 1000; // 1 minute

/** Max age for community message sync (ms). 60 days. */
const SYNC_MAX_AGE = 60 * 24 * 60 * 60 * 1000;

interface PeerConnection {
  nodeId: string;
  url: string;
  name: string;
  ws: WebSocket;
  communityIds: string[];
  connected: boolean;
  version: string;
  /** R25 — Phase 6. Ed25519 pubkey of the peer's DHT identity, hex. */
  dhtPubkey?: string;
  /** R25 — Phase 6. ws URL the peer advertises in DHT records. */
  dhtUrl?: string;
}

export class PeerManager {
  private nodeDB: NodeDB;
  private messageDB: RelayDB;
  private communityDB: CommunityDB;
  private dmDB: DMDB;
  private nodeId: string;
  private nodeUrl: string;
  private nodeName: string;

  /** Active outbound connections to peers. Keyed by nodeId. */
  private peers = new Map<string, PeerConnection>();

  /** Inbound peer connections (peers that connected to us). Keyed by nodeId. */
  private inboundPeers = new Map<string, { nodeId: string; ws: WebSocket; communityIds: string[]; version: string; dhtPubkey?: string; dhtUrl?: string }>();

  private pexTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;

  // R25 — Phase 5: pluggable hooks for the swarm layer. peerManager owns
  // peer connections; swarmManager piggybacks on them for HAVE/WANT
  // exchange. Hooks are called from existing message dispatch sites.
  private swarmHooks: {
    onConnect?: (peerId: string) => void;
    onDisconnect?: (peerId: string) => void;
    onMessage?: (peerId: string, msg: any) => void;
  } | null = null;

  // R25 — Phase 6: parallel hooks for the DHT layer. Includes the peer's
  // dht pubkey/url so the DHT can build a Contact for routing-table
  // bookkeeping. onConnect fires only once we've actually learned the
  // peer's dht identity from its handshake.
  private dhtHooks: {
    onConnect?: (peerId: string, dhtPubkeyHex: string, dhtUrl: string) => void;
    onDisconnect?: (peerId: string) => void;
    onMessage?: (peerId: string, msg: any) => void;
  } | null = null;

  // R25 — Phase 6: this relay's own dht advertisement, set before start().
  private dhtIdentity: { pubkeyHex: string; url: string } | null = null;

  constructor(
    nodeDB: NodeDB,
    messageDB: RelayDB,
    communityDB: CommunityDB,
    dmDB: DMDB,
    nodeUrl: string,
  ) {
    this.nodeDB = nodeDB;
    this.messageDB = messageDB;
    this.communityDB = communityDB;
    this.dmDB = dmDB;
    this.nodeId = nodeDB.getNodeId();
    this.nodeUrl = nodeUrl;
    this.nodeName = nodeDB.getNodeName();
  }

  // =================================================================
  // Lifecycle
  // =================================================================

  /** Start the peer manager: connect to known peers, begin PEX. */
  start(): void {
    console.log(`[peer] Starting peer manager (nodeId: ${this.nodeId.slice(0, 16)}...)`);

    // Add seed nodes if we have no known peers
    const knownPeers = this.nodeDB.getAllPeers();
    if (knownPeers.length === 0 && SEED_NODES.length > 0) {
      for (const seed of SEED_NODES) {
        this.nodeDB.addOrUpdatePeer('seed-' + seed.url, seed.url, seed.name);
      }
      console.log(`[peer] Added ${SEED_NODES.length} seed nodes`);
    }

    // Connect to all known peers
    this.connectToKnownPeers();

    // Periodic PEX gossip
    this.pexTimer = setInterval(() => this.doPexRound(), PEX_INTERVAL);

    // Periodic reconnect attempts for failed peers
    this.reconnectTimer = setInterval(() => this.connectToKnownPeers(), RECONNECT_INTERVAL);

    console.log(`[peer] Peer manager started. Known peers: ${this.nodeDB.getPeerCount()}`);
  }

  /**
   * R25 — Phase 5. Register swarm-layer callbacks. peerManager will:
   *   - call `onConnect(peerId)` on each successful handshake (in/out)
   *   - call `onDisconnect(peerId)` on close
   *   - call `onMessage(peerId, msg)` for any frame whose `type === 'SWARM'`
   */
  setSwarmHooks(hooks: {
    onConnect?: (peerId: string) => void;
    onDisconnect?: (peerId: string) => void;
    onMessage?: (peerId: string, msg: any) => void;
  }): void {
    this.swarmHooks = hooks;
  }

  /**
   * R25 — Phase 5. Send a JSON message to a peer by node id. Tries the
   * outbound connection first, then the inbound one. Returns false if
   * neither is open.
   */
  sendToPeer(peerId: string, msg: unknown): boolean {
    const out = this.peers.get(peerId);
    if (out && out.ws.readyState === WebSocket.OPEN) {
      try { out.ws.send(JSON.stringify(msg)); return true; } catch { /* fall through */ }
    }
    const inb = this.inboundPeers.get(peerId);
    if (inb && inb.ws.readyState === WebSocket.OPEN) {
      try { inb.ws.send(JSON.stringify(msg)); return true; } catch { /* ignore */ }
    }
    return false;
  }

  /**
   * R25 — Phase 6. Register DHT-layer callbacks. peerManager will:
   *   - call `onConnect(peerId, dhtPubkey, dhtUrl)` once the inbound
   *     handshake reveals a dht identity
   *   - call `onDisconnect(peerId)` on close
   *   - call `onMessage(peerId, msg)` for any frame whose `type === 'DHT'`
   */
  setDhtHooks(hooks: {
    onConnect?: (peerId: string, dhtPubkeyHex: string, dhtUrl: string) => void;
    onDisconnect?: (peerId: string) => void;
    onMessage?: (peerId: string, msg: any) => void;
  }): void {
    this.dhtHooks = hooks;
  }

  /** R25 — Phase 6. Set this relay's DHT identity. MUST be called before start(). */
  setDhtIdentity(pubkeyHex: string, url: string): void {
    this.dhtIdentity = { pubkeyHex, url };
  }

  /** R25 — Phase 6. (peerStringId, dhtPubkey, dhtUrl) snapshot for DHT bootstrap. */
  getDhtPeers(): Array<{ peerId: string; dhtPubkeyHex: string; dhtUrl: string }> {
    const out: Array<{ peerId: string; dhtPubkeyHex: string; dhtUrl: string }> = [];
    for (const [id, c] of this.peers) {
      if (c.connected && c.dhtPubkey && c.dhtUrl) out.push({ peerId: id, dhtPubkeyHex: c.dhtPubkey, dhtUrl: c.dhtUrl });
    }
    for (const [id, c] of this.inboundPeers) {
      if (c.dhtPubkey && c.dhtUrl) out.push({ peerId: id, dhtPubkeyHex: c.dhtPubkey, dhtUrl: c.dhtUrl });
    }
    return out;
  }

  /** R25 — Phase 5. Connected peer node ids (in + out, deduplicated). */
  getConnectedPeerIds(): string[] {
    const ids = new Set<string>();
    for (const [id, c] of this.peers) if (c.connected) ids.add(id);
    for (const id of this.inboundPeers.keys()) ids.add(id);
    return [...ids];
  }

  /** Stop the peer manager and close all connections. */
  stop(): void {
    if (this.pexTimer) clearInterval(this.pexTimer);
    if (this.reconnectTimer) clearInterval(this.reconnectTimer);

    for (const [, peer] of this.peers) {
      peer.ws.close(1000, 'Node shutting down');
    }
    this.peers.clear();
    this.inboundPeers.clear();
  }

  // =================================================================
  // Outbound connections (this node → peer)
  // =================================================================

  private connectToKnownPeers(): void {
    const allPeers = this.nodeDB.getAllPeers();
    for (const peer of allPeers) {
      // Skip if already connected (outbound or inbound)
      if (this.peers.has(peer.nodeId) || this.inboundPeers.has(peer.nodeId)) continue;
      // Skip connecting to ourselves
      if (peer.nodeId === this.nodeId) continue;
      // Skip if URL matches our own
      if (peer.url === this.nodeUrl) continue;

      this.connectToPeer(peer.nodeId, peer.url, peer.name);
    }
  }

  private connectToPeer(nodeId: string, url: string, name: string): void {
    try {
      const ws = new WebSocket(url);

      const conn: PeerConnection = { nodeId, url, name, ws, communityIds: [], connected: false, version: '' };
      this.peers.set(nodeId, conn);

      ws.on('open', () => {
        console.log(`[peer] Connected to peer: ${name} (${url})`);
        conn.connected = true;

        // Send handshake
        const myCommunities = this.communityDB.getAllCommunityIds();
        const payload: Record<string, unknown> = {
          nodeId: this.nodeId,
          url: this.nodeUrl,
          name: this.nodeName,
          communityIds: myCommunities,
          version: getCurrentVersion(),
        };
        // R25 — Phase 6. Advertise DHT identity if known.
        if (this.dhtIdentity) {
          payload.dhtPubkey = this.dhtIdentity.pubkeyHex;
          payload.dhtUrl = this.dhtIdentity.url;
        }
        ws.send(JSON.stringify({
          type: 'NODE_HANDSHAKE',
          payload,
          timestamp: Date.now(),
        }));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          // R25 — Phase 5/6. Swarm + DHT frames bypass community routing.
          if (msg && msg.type === 'SWARM') {
            this.swarmHooks?.onMessage?.(conn.nodeId, msg);
            return;
          }
          if (msg && msg.type === 'DHT') {
            this.dhtHooks?.onMessage?.(conn.nodeId, msg);
            return;
          }
          this.handlePeerMessage(conn, msg);
        } catch { /* ignore parse errors */ }
      });

      ws.on('close', () => {
        console.log(`[peer] Disconnected from peer: ${name}`);
        conn.connected = false;
        // R25 — Phase 5/6. Notify swarm + DHT before dropping the connection.
        try { this.swarmHooks?.onDisconnect?.(conn.nodeId); } catch { /* ignore */ }
        try { this.dhtHooks?.onDisconnect?.(conn.nodeId); } catch { /* ignore */ }
        this.peers.delete(conn.nodeId);
      });

      ws.on('error', (err) => {
        // Silently handle connection errors (peer might be offline)
        this.peers.delete(nodeId);
      });
    } catch {
      this.peers.delete(nodeId);
    }
  }

  // =================================================================
  // Inbound peer connections (peer → this node)
  // =================================================================

  /** Called from index.ts when a WS client sends NODE_HANDSHAKE. */
  handleInboundHandshake(ws: WebSocket, msg: any): void {
    const { nodeId, url, name, communityIds, version, dhtPubkey, dhtUrl } = msg.payload || {};
    if (!nodeId || !url) return;

    console.log(`[peer] Inbound peer: ${name || nodeId.slice(0, 16)} (${url}) v${version}`);

    // Store the inbound connection
    const entry: { nodeId: string; ws: WebSocket; communityIds: string[]; version: string; dhtPubkey?: string; dhtUrl?: string } = {
      nodeId,
      ws,
      communityIds: communityIds || [],
      version: version || '',
    };
    if (typeof dhtPubkey === 'string') entry.dhtPubkey = dhtPubkey;
    if (typeof dhtUrl === 'string') entry.dhtUrl = dhtUrl;
    this.inboundPeers.set(nodeId, entry);

    // Update our known peers DB
    this.nodeDB.addOrUpdatePeer(nodeId, url, name || '', communityIds || []);

    // Send handshake ack
    const myCommunities = this.communityDB.getAllCommunityIds();
    const ackPayload: Record<string, unknown> = {
      nodeId: this.nodeId,
      url: this.nodeUrl,
      name: this.nodeName,
      communityIds: myCommunities,
      version: getCurrentVersion(),
    };
    if (this.dhtIdentity) {
      ackPayload.dhtPubkey = this.dhtIdentity.pubkeyHex;
      ackPayload.dhtUrl = this.dhtIdentity.url;
    }
    ws.send(JSON.stringify({
      type: 'NODE_HANDSHAKE_ACK',
      payload: ackPayload,
      timestamp: Date.now(),
    }));

    // Share our peer list
    this.sendPexTo(ws);

    // Sync communities in common
    this.syncWithPeer(nodeId, communityIds || []);

    // R25 — Phase 5. Notify swarm layer of new inbound peer.
    try { this.swarmHooks?.onConnect?.(nodeId); } catch { /* ignore */ }
    // R25 — Phase 6. DHT learns the inbound peer if its identity is on the wire.
    if (entry.dhtPubkey && entry.dhtUrl) {
      try { this.dhtHooks?.onConnect?.(nodeId, entry.dhtPubkey, entry.dhtUrl); } catch { /* ignore */ }
    }

    ws.on('close', () => {
      try { this.swarmHooks?.onDisconnect?.(nodeId); } catch { /* ignore */ }
      try { this.dhtHooks?.onDisconnect?.(nodeId); } catch { /* ignore */ }
      this.inboundPeers.delete(nodeId);
    });

    // Handle messages from the inbound peer
    ws.on('message', (data) => {
      try {
        const peerMsg = JSON.parse(data.toString());
        // R25 — Phase 5/6. Route SWARM/DHT frames to their layers first.
        if (peerMsg.type === 'SWARM') {
          this.swarmHooks?.onMessage?.(nodeId, peerMsg);
          return;
        }
        if (peerMsg.type === 'DHT') {
          this.dhtHooks?.onMessage?.(nodeId, peerMsg);
          return;
        }
        // Route peer messages
        if (peerMsg.type === 'PEX_SHARE') this.handlePexShare(peerMsg);
        if (peerMsg.type === 'NODE_SYNC_REQUEST') this.handleSyncRequest(ws, peerMsg);
        if (peerMsg.type === 'NODE_SYNC_RESPONSE') this.handleSyncResponse(peerMsg);
        if (peerMsg.type === 'MESSAGE_FORWARD') this.handleMessageForward(peerMsg);
        if (peerMsg.type === 'DM_FORWARD') this.handleDMForward(peerMsg);
      } catch { /* ignore */ }
    });
  }

  // =================================================================
  // Peer message handling
  // =================================================================

  private handlePeerMessage(conn: PeerConnection, msg: any): void {
    switch (msg.type) {
      case 'AUTH_CHALLENGE':
        // Peer relay sent us an auth challenge — we're connecting as a "peer client"
        // Skip auth by sending NODE_HANDSHAKE directly (relay needs to recognize this)
        break;

      case 'NODE_HANDSHAKE_ACK':
        this.handleHandshakeAck(conn, msg);
        break;

      case 'PEX_SHARE':
        this.handlePexShare(msg);
        break;

      case 'NODE_SYNC_RESPONSE':
        this.handleSyncResponse(msg);
        break;

      case 'MESSAGE_FORWARD':
        this.handleMessageForward(msg);
        break;

      case 'DM_FORWARD':
        this.handleDMForward(msg);
        break;
    }
  }

  private handleHandshakeAck(conn: PeerConnection, msg: any): void {
    const { nodeId, url, name, communityIds, version, dhtPubkey, dhtUrl } = msg.payload || {};
    // Update the connection with the real nodeId from the peer
    if (nodeId && nodeId !== conn.nodeId) {
      this.peers.delete(conn.nodeId);
      conn.nodeId = nodeId;
      this.peers.set(nodeId, conn);
    }
    conn.communityIds = communityIds || [];
    conn.version = version || '';
    if (typeof dhtPubkey === 'string') conn.dhtPubkey = dhtPubkey;
    if (typeof dhtUrl === 'string') conn.dhtUrl = dhtUrl;

    // Update DB
    this.nodeDB.addOrUpdatePeer(nodeId, url || conn.url, name || conn.name, communityIds || []);

    console.log(`[peer] Handshake complete with: ${name || nodeId.slice(0, 16)} (${communityIds?.length || 0} communities)`);

    // Share our peer list
    this.sendPexTo(conn.ws);

    // Sync communities in common
    this.syncWithPeer(nodeId, communityIds || []);

    // R25 — Phase 5. Tell swarm layer about the new peer so it can
    // send a fresh HAVE_ANNOUNCE and start tracking want budgets.
    try { this.swarmHooks?.onConnect?.(nodeId); } catch { /* ignore */ }
    // R25 — Phase 6. DHT learns the new peer if its identity is on the wire.
    if (conn.dhtPubkey && conn.dhtUrl) {
      try { this.dhtHooks?.onConnect?.(nodeId, conn.dhtPubkey, conn.dhtUrl); } catch { /* ignore */ }
    }
  }

  // =================================================================
  // PEX — Peer Exchange Protocol
  // =================================================================

  private doPexRound(): void {
    const allPeers = this.nodeDB.getAllPeers();
    const peerList = allPeers.map((p) => ({ nodeId: p.nodeId, url: p.url, lastSeen: p.lastSeen }));

    // Send to all connected peers (outbound + inbound)
    for (const [, conn] of this.peers) {
      if (conn.connected && conn.ws.readyState === WebSocket.OPEN) {
        this.sendPexTo(conn.ws);
      }
    }
    for (const [, conn] of this.inboundPeers) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        this.sendPexTo(conn.ws);
      }
    }

    // Cleanup stale peers
    const cleaned = this.nodeDB.cleanupStalePeers(7);
    if (cleaned > 0) console.log(`[peer] Cleaned up ${cleaned} stale peers`);
  }

  private sendPexTo(ws: WebSocket): void {
    const allPeers = this.nodeDB.getAllPeers();
    const peerList = allPeers.map((p) => ({ nodeId: p.nodeId, url: p.url, lastSeen: p.lastSeen }));

    // Include ourselves
    peerList.push({ nodeId: this.nodeId, url: this.nodeUrl, lastSeen: Date.now() });

    ws.send(JSON.stringify({
      type: 'PEX_SHARE',
      payload: { peers: peerList },
      timestamp: Date.now(),
    }));
  }

  private handlePexShare(msg: any): void {
    const peers = msg.payload?.peers || [];
    let added = 0;

    for (const peer of peers) {
      if (!peer.nodeId || !peer.url) continue;
      if (peer.nodeId === this.nodeId) continue; // Skip ourselves
      if (peer.url === this.nodeUrl) continue;

      const existing = this.nodeDB.getPeer(peer.nodeId);
      if (!existing) {
        this.nodeDB.addOrUpdatePeer(peer.nodeId, peer.url, '', []);
        added++;
      } else if (peer.lastSeen > existing.lastSeen) {
        // Update if the incoming info is newer
        this.nodeDB.addOrUpdatePeer(peer.nodeId, peer.url, existing.name, JSON.parse(existing.communityIds || '[]'));
      }
    }

    if (added > 0) {
      console.log(`[peer] PEX: discovered ${added} new peers (total: ${this.nodeDB.getPeerCount()})`);
      // Try connecting to newly discovered peers
      this.connectToKnownPeers();
    }
  }

  // =================================================================
  // Community Replication / Sync
  // =================================================================

  /** Request sync for communities we have in common with a peer. */
  private syncWithPeer(peerNodeId: string, peerCommunityIds: string[]): void {
    const myCommunities = this.communityDB.getAllCommunityIds();
    const common = myCommunities.filter((id) => peerCommunityIds.includes(id));

    if (common.length === 0) return;

    console.log(`[peer] Syncing ${common.length} communities with ${peerNodeId.slice(0, 16)}`);

    const since = Date.now() - SYNC_MAX_AGE;

    for (const communityId of common) {
      const ws = this.getPeerWs(peerNodeId);
      if (!ws) continue;

      ws.send(JSON.stringify({
        type: 'NODE_SYNC_REQUEST',
        payload: { communityId, since, requestingNodeId: this.nodeId },
        timestamp: Date.now(),
      }));
    }
  }

  /** Handle a sync request from a peer — send our messages. */
  private handleSyncRequest(ws: WebSocket, msg: any): void {
    const { communityId, since } = msg.payload || {};
    if (!communityId) return;

    const messages = this.messageDB.getMessagesSince(communityId, since || 0);
    // Send in batches of 100
    const BATCH = 100;
    for (let i = 0; i < messages.length; i += BATCH) {
      const batch = messages.slice(i, i + BATCH);
      ws.send(JSON.stringify({
        type: 'NODE_SYNC_RESPONSE',
        payload: {
          communityId,
          messages: batch.map((m) => ({
            messageId: m.messageId,
            channel: m.channel,
            content: m.content,
            senderPublicKey: m.senderPublicKey,
            senderUsername: m.senderUsername,
            timestamp: m.timestamp,
            signature: m.signature || '',
          })),
          hasMore: i + BATCH < messages.length,
        },
        timestamp: Date.now(),
      }));
    }

    if (messages.length === 0) {
      ws.send(JSON.stringify({
        type: 'NODE_SYNC_RESPONSE',
        payload: { communityId, messages: [], hasMore: false },
        timestamp: Date.now(),
      }));
    }
  }

  /** Handle incoming synced messages from a peer. */
  private handleSyncResponse(msg: any): void {
    const { communityId, messages } = msg.payload || {};
    if (!messages || messages.length === 0) return;

    let stored = 0;
    for (const m of messages) {
      try {
        this.messageDB.storeMessage({
          messageId: m.messageId,
          channel: m.channel,
          content: m.content,
          senderPublicKey: m.senderPublicKey,
          senderUsername: m.senderUsername,
          timestamp: m.timestamp,
          signature: m.signature || '',
        });
        stored++;
      } catch { /* duplicate messageId — already have it */ }
    }

    if (stored > 0) {
      console.log(`[peer] Sync: stored ${stored} messages for community ${communityId?.slice(0, 8)}`);
    }
  }

  // =================================================================
  // Message Forwarding (real-time replication)
  // =================================================================

  /** Forward a community message to all connected peers that host the same community. */
  forwardMessage(communityId: string, message: {
    messageId: string; channel: string; content: string;
    senderPublicKey: string; senderUsername: string;
    timestamp: number; signature: string;
  }): void {
    const forwardMsg = JSON.stringify({
      type: 'MESSAGE_FORWARD',
      payload: { sourceNodeId: this.nodeId, communityId, message },
      timestamp: Date.now(),
    });

    this.broadcastToPeers(forwardMsg, communityId);
  }

  /** Forward a DM to all connected peers. */
  forwardDM(dm: {
    messageId: string; senderPublicKey: string; senderUsername: string;
    recipientPublicKey: string; content: string;
    timestamp: number; signature: string;
  }): void {
    const forwardMsg = JSON.stringify({
      type: 'DM_FORWARD',
      payload: { sourceNodeId: this.nodeId, dm },
      timestamp: Date.now(),
    });

    // DMs go to all peers (we don't know which node the recipient is on)
    this.broadcastToPeers(forwardMsg);
  }

  /** Handle a forwarded community message from a peer. Store it locally. */
  private handleMessageForward(msg: any): void {
    const { sourceNodeId, communityId, message } = msg.payload || {};
    if (sourceNodeId === this.nodeId) return; // Loop prevention

    try {
      this.messageDB.storeMessage({
        messageId: message.messageId,
        channel: message.channel,
        content: message.content,
        senderPublicKey: message.senderPublicKey,
        senderUsername: message.senderUsername,
        timestamp: message.timestamp,
        signature: message.signature || '',
      });
    } catch { /* duplicate — already have it */ }
  }

  /** Handle a forwarded DM from a peer. Store it locally. */
  private handleDMForward(msg: any): void {
    const { sourceNodeId, dm } = msg.payload || {};
    if (sourceNodeId === this.nodeId) return;

    try {
      this.dmDB.storeDM(dm);
    } catch { /* duplicate */ }
  }

  // =================================================================
  // Client-facing: list of known nodes
  // =================================================================

  /** Get info about all known nodes (for GET_NODES client request). */
  getNodeList(): Array<{ nodeId: string; url: string; name: string; lastSeen: number; communityCount: number }> {
    const peers = this.nodeDB.getAllPeers();
    const result = peers.map((p) => ({
      nodeId: p.nodeId,
      url: p.url,
      name: p.name,
      lastSeen: p.lastSeen,
      communityCount: JSON.parse(p.communityIds || '[]').length,
    }));

    // Include ourselves
    result.unshift({
      nodeId: this.nodeId,
      url: this.nodeUrl,
      name: this.nodeName,
      lastSeen: Date.now(),
      communityCount: this.communityDB.getCommunityCount(),
    });

    return result;
  }

  getNodeId(): string { return this.nodeId; }
  getConnectedPeerCount(): number { return this.peers.size + this.inboundPeers.size; }

  /** Get version info for all connected peers. */
  getPeerVersions(): Array<{ nodeId: string; name: string; url: string; version: string }> {
    const result: Array<{ nodeId: string; name: string; url: string; version: string }> = [];
    for (const [, conn] of this.peers) {
      if (conn.connected) {
        result.push({ nodeId: conn.nodeId, name: conn.name, url: conn.url, version: conn.version || 'unknown' });
      }
    }
    for (const [, conn] of this.inboundPeers) {
      result.push({ nodeId: conn.nodeId, name: '', url: '', version: conn.version || 'unknown' });
    }
    return result;
  }

  // =================================================================
  // Helpers
  // =================================================================

  private getPeerWs(nodeId: string): WebSocket | null {
    const outbound = this.peers.get(nodeId);
    if (outbound?.connected && outbound.ws.readyState === WebSocket.OPEN) return outbound.ws;
    const inbound = this.inboundPeers.get(nodeId);
    if (inbound && inbound.ws.readyState === WebSocket.OPEN) return inbound.ws;
    return null;
  }

  private broadcastToPeers(payload: string, communityId?: string): void {
    // Outbound peers
    for (const [, conn] of this.peers) {
      if (!conn.connected || conn.ws.readyState !== WebSocket.OPEN) continue;
      if (communityId && !conn.communityIds.includes(communityId)) continue;
      conn.ws.send(payload);
    }
    // Inbound peers
    for (const [, conn] of this.inboundPeers) {
      if (conn.ws.readyState !== WebSocket.OPEN) continue;
      if (communityId && !conn.communityIds.includes(communityId)) continue;
      conn.ws.send(payload);
    }
  }
}
