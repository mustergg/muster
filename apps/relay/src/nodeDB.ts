/**
 * Node Database — R15
 *
 * Stores this node's identity and known peer nodes.
 * Node ID is generated once and persisted.
 */

import type Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

export interface DBPeerNode {
  nodeId: string;
  url: string;
  name: string;
  communityIds: string;   // JSON array of community IDs hosted on this peer
  lastSeen: number;
  addedAt: number;
}

function initNodeTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS node_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS known_peers (
      nodeId       TEXT PRIMARY KEY,
      url          TEXT NOT NULL,
      name         TEXT NOT NULL DEFAULT '',
      communityIds TEXT NOT NULL DEFAULT '[]',
      lastSeen     INTEGER NOT NULL,
      addedAt      INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_peers_lastseen ON known_peers (lastSeen);
  `);
}

export class NodeDB {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    initNodeTables(db);
    console.log('[relay-db] Node tables initialized.');
  }

  // =================================================================
  // Node Identity
  // =================================================================

  /** Get or generate this node's unique ID. */
  getNodeId(): string {
    const row = this.db.prepare("SELECT value FROM node_config WHERE key = 'nodeId'").get() as { value: string } | undefined;
    if (row) return row.value;

    const nodeId = 'node-' + randomBytes(16).toString('hex');
    this.db.prepare("INSERT INTO node_config (key, value) VALUES ('nodeId', ?)").run(nodeId);
    console.log(`[node-db] Generated node ID: ${nodeId}`);
    return nodeId;
  }

  /**
   * R25 — Phase 6. Get or generate the relay's persistent Ed25519 keypair
   * (used as the DHT node identity). Returned hex-encoded so it round-trips
   * through the existing `node_config` text column.
   */
  async getOrCreateNodeKeypair(): Promise<{ publicKeyHex: string; privateKeyHex: string }> {
    const pub = this.db.prepare("SELECT value FROM node_config WHERE key = 'nodePubkey'").get() as { value: string } | undefined;
    const priv = this.db.prepare("SELECT value FROM node_config WHERE key = 'nodePrivkey'").get() as { value: string } | undefined;
    if (pub && priv) return { publicKeyHex: pub.value, privateKeyHex: priv.value };

    const { generateKeyPair, toHex } = await import('@muster/crypto');
    const kp = await generateKeyPair();
    const publicKeyHex = toHex(kp.publicKey);
    const privateKeyHex = toHex(kp.privateKey);
    this.db.prepare("INSERT OR REPLACE INTO node_config (key, value) VALUES ('nodePubkey', ?)").run(publicKeyHex);
    this.db.prepare("INSERT OR REPLACE INTO node_config (key, value) VALUES ('nodePrivkey', ?)").run(privateKeyHex);
    console.log(`[node-db] Generated Ed25519 node keypair: ${publicKeyHex.slice(0, 16)}...`);
    return { publicKeyHex, privateKeyHex };
  }

  /** Get or set the node's display name. */
  getNodeName(): string {
    const row = this.db.prepare("SELECT value FROM node_config WHERE key = 'nodeName'").get() as { value: string } | undefined;
    return row?.value || 'Muster Node';
  }

  setNodeName(name: string): void {
    this.db.prepare("INSERT OR REPLACE INTO node_config (key, value) VALUES ('nodeName', ?)").run(name);
  }

  /** Get a config value. */
  getConfig(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM node_config WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  setConfig(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO node_config (key, value) VALUES (?, ?)').run(key, value);
  }

  // =================================================================
  // Known Peers
  // =================================================================

  addOrUpdatePeer(nodeId: string, url: string, name: string, communityIds: string[] = []): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO known_peers (nodeId, url, name, communityIds, lastSeen, addedAt)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(nodeId) DO UPDATE SET
        url = excluded.url,
        name = excluded.name,
        communityIds = excluded.communityIds,
        lastSeen = excluded.lastSeen
    `).run(nodeId, url, name, JSON.stringify(communityIds), now, now);
  }

  getPeer(nodeId: string): DBPeerNode | undefined {
    return this.db.prepare('SELECT * FROM known_peers WHERE nodeId = ?').get(nodeId) as DBPeerNode | undefined;
  }

  getAllPeers(): DBPeerNode[] {
    return this.db.prepare('SELECT * FROM known_peers ORDER BY lastSeen DESC').all() as DBPeerNode[];
  }

  /** Get peers that host a specific community. */
  getPeersForCommunity(communityId: string): DBPeerNode[] {
    const all = this.getAllPeers();
    return all.filter((p) => {
      try {
        const ids: string[] = JSON.parse(p.communityIds);
        return ids.includes(communityId);
      } catch { return false; }
    });
  }

  removePeer(nodeId: string): void {
    this.db.prepare('DELETE FROM known_peers WHERE nodeId = ?').run(nodeId);
  }

  /** Remove peers not seen in the last N days. */
  cleanupStalePeers(maxAgeDays = 7): number {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const result = this.db.prepare('DELETE FROM known_peers WHERE lastSeen < ?').run(cutoff);
    return result.changes;
  }

  getPeerCount(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM known_peers').get() as any).c;
  }
}
