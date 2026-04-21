/**
 * Node Tier System — R21
 *
 * Defines the three-tier node architecture:
 *   Main Node   — dedicated infrastructure, permanent retention
 *   Client Node — user's PC hosting communities/squads, permanent retention for hosted content
 *   Temp Node   — browser/mobile user, 10% passive contribution, 30-day retention for non-hosted
 *
 * Storage policies:
 *   - Hosted communities/squads → permanent retention (Main + Client)
 *   - Non-hosted content → 30-day buffer (recovery window)
 *   - User-configurable: keep all, auto-purge N days, keep only viewed, per-community/DM overrides
 */

import { NodeDB } from './nodeDB';
import { RelayDB } from './database';
import { DMDB } from './dmDB';
import { CommunityDB } from './communityDB';

// =================================================================
// Types
// =================================================================

export type NodeTier = 'main' | 'client' | 'temp';

export interface TierConfig {
  tier: NodeTier;
  /** Max disk usage in MB (0 = unlimited). */
  maxDiskMB: number;
  /** Max bandwidth contribution in MB/day (0 = unlimited). */
  maxBandwidthMBPerDay: number;
  /** Percentage of resources contributed to network (temp/client). */
  networkContributionPercent: number;
  /** Default retention days for non-hosted content (0 = permanent). */
  defaultRetentionDays: number;
  /** IDs of communities this node permanently hosts. */
  hostedCommunityIds: string[];
  /** IDs of squads this node permanently hosts. */
  hostedSquadIds: string[];
}

export interface StorageStats {
  tier: NodeTier;
  totalMessages: number;
  totalDMs: number;
  totalFiles: number;
  fileSizeKB: number;
  hostedCommunities: number;
  cachedCommunities: number;
  oldestMessage: number;
  retentionDays: number;
}

/** Per-user retention overrides (stored in node_config as JSON). */
export interface UserRetentionOverride {
  /** Community/squad/DM id. */
  targetId: string;
  /** 'community' | 'squad' | 'dm'. */
  targetType: string;
  /** Retention days (0 = permanent, -1 = delete immediately). */
  retentionDays: number;
}

// =================================================================
// Defaults
// =================================================================

const DEFAULT_CONFIGS: Record<NodeTier, Omit<TierConfig, 'hostedCommunityIds' | 'hostedSquadIds'>> = {
  main: {
    tier: 'main',
    maxDiskMB: 0,           // unlimited
    maxBandwidthMBPerDay: 0, // unlimited
    networkContributionPercent: 10,
    defaultRetentionDays: 0, // permanent
  },
  client: {
    tier: 'client',
    maxDiskMB: 5120,         // 5GB default
    maxBandwidthMBPerDay: 1024, // 1GB/day
    networkContributionPercent: 10,
    defaultRetentionDays: 0, // permanent for hosted, 30 for cached
  },
  temp: {
    tier: 'temp',
    maxDiskMB: 512,          // 512MB
    maxBandwidthMBPerDay: 256, // 256MB/day
    networkContributionPercent: 10,
    defaultRetentionDays: 30,
  },
};

// =================================================================
// Tier Manager
// =================================================================

export class TierManager {
  private config: TierConfig;
  private nodeDB: NodeDB;
  private purgeInterval: ReturnType<typeof setInterval> | null = null;

  constructor(nodeDB: NodeDB) {
    this.nodeDB = nodeDB;
    this.config = this.loadConfig();
    console.log(`[tier] Node tier: ${this.config.tier}`);
    console.log(`[tier] Hosting ${this.config.hostedCommunityIds.length} communities, ${this.config.hostedSquadIds.length} squads`);
    console.log(`[tier] Retention: ${this.config.defaultRetentionDays === 0 ? 'permanent' : this.config.defaultRetentionDays + ' days'}`);
  }

  /** Load tier config from DB, or initialize with defaults. */
  private loadConfig(): TierConfig {
    const stored = this.nodeDB.getConfig('tierConfig');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch { /* fall through to defaults */ }
    }

    // Default to 'main' tier for existing nodes (backward compat)
    const tierStr = process.env.MUSTER_NODE_TIER || this.nodeDB.getConfig('nodeTier') || 'main';
    const tier = (['main', 'client', 'temp'].includes(tierStr) ? tierStr : 'main') as NodeTier;
    const defaults = DEFAULT_CONFIGS[tier];

    const config: TierConfig = {
      ...defaults,
      hostedCommunityIds: [],
      hostedSquadIds: [],
    };

    // If main node, auto-host all existing communities
    if (tier === 'main') {
      // Will be populated after communityDB is available
    }

    this.saveConfig(config);
    return config;
  }

  /** Save config to DB. */
  private saveConfig(config: TierConfig): void {
    this.nodeDB.setConfig('tierConfig', JSON.stringify(config));
    this.nodeDB.setConfig('nodeTier', config.tier);
  }

  // =================================================================
  // Public API
  // =================================================================

  getTier(): NodeTier { return this.config.tier; }
  getConfig(): TierConfig { return { ...this.config }; }

  /** Set the node tier. */
  setTier(tier: NodeTier): void {
    const defaults = DEFAULT_CONFIGS[tier];
    this.config = {
      ...this.config,
      ...defaults,
      hostedCommunityIds: this.config.hostedCommunityIds,
      hostedSquadIds: this.config.hostedSquadIds,
    };
    this.saveConfig(this.config);
    console.log(`[tier] Tier changed to: ${tier}`);
  }

  /** Update resource limits. */
  setLimits(limits: { maxDiskMB?: number; maxBandwidthMBPerDay?: number; networkContributionPercent?: number; defaultRetentionDays?: number }): void {
    if (limits.maxDiskMB !== undefined) this.config.maxDiskMB = limits.maxDiskMB;
    if (limits.maxBandwidthMBPerDay !== undefined) this.config.maxBandwidthMBPerDay = limits.maxBandwidthMBPerDay;
    if (limits.networkContributionPercent !== undefined) this.config.networkContributionPercent = Math.min(100, Math.max(0, limits.networkContributionPercent));
    if (limits.defaultRetentionDays !== undefined) this.config.defaultRetentionDays = limits.defaultRetentionDays;
    this.saveConfig(this.config);
  }

  /** Add a community to permanent hosting. */
  hostCommunity(communityId: string): void {
    if (!this.config.hostedCommunityIds.includes(communityId)) {
      this.config.hostedCommunityIds.push(communityId);
      this.saveConfig(this.config);
      console.log(`[tier] Now hosting community: ${communityId.slice(0, 12)}`);
    }
  }

  /** Remove a community from permanent hosting. */
  unhostCommunity(communityId: string): void {
    this.config.hostedCommunityIds = this.config.hostedCommunityIds.filter((id) => id !== communityId);
    this.saveConfig(this.config);
    console.log(`[tier] Stopped hosting community: ${communityId.slice(0, 12)}`);
  }

  /** Add a squad to permanent hosting. */
  hostSquad(squadId: string): void {
    if (!this.config.hostedSquadIds.includes(squadId)) {
      this.config.hostedSquadIds.push(squadId);
      this.saveConfig(this.config);
    }
  }

  /** Remove a squad from permanent hosting. */
  unhostSquad(squadId: string): void {
    this.config.hostedSquadIds = this.config.hostedSquadIds.filter((id) => id !== squadId);
    this.saveConfig(this.config);
  }

  /** Check if a community is permanently hosted on this node. */
  isHosted(communityId: string): boolean {
    if (this.config.tier === 'main') return true; // Main nodes host everything
    return this.config.hostedCommunityIds.includes(communityId);
  }

  /** Check if a squad is hosted. */
  isSquadHosted(squadId: string): boolean {
    if (this.config.tier === 'main') return true;
    return this.config.hostedSquadIds.includes(squadId);
  }

  /** Auto-host all communities on this node (for main nodes). */
  autoHostAll(communityDB: CommunityDB): void {
    if (this.config.tier === 'main') {
      const allIds = communityDB.getAllCommunityIds();
      this.config.hostedCommunityIds = allIds;
      this.saveConfig(this.config);
      console.log(`[tier] Auto-hosting all ${allIds.length} communities (main node)`);
    }
  }

  /** Get retention days for a specific community. */
  getRetentionDays(communityId: string): number {
    if (this.isHosted(communityId)) return 0; // permanent
    return this.config.defaultRetentionDays || 30;
  }

  // =================================================================
  // Purge Scheduler
  // =================================================================

  /** Start the automatic purge scheduler. */
  startPurgeScheduler(messageDB: RelayDB, dmDB: DMDB): void {
    // Run purge every 6 hours
    const PURGE_INTERVAL = 6 * 60 * 60 * 1000;

    // Initial purge after 30 seconds
    setTimeout(() => this.runPurge(messageDB, dmDB), 30000);

    this.purgeInterval = setInterval(() => {
      this.runPurge(messageDB, dmDB);
    }, PURGE_INTERVAL);

    console.log(`[tier] Purge scheduler started (every 6h)`);
  }

  /** Stop the purge scheduler. */
  stopPurgeScheduler(): void {
    if (this.purgeInterval) {
      clearInterval(this.purgeInterval);
      this.purgeInterval = null;
    }
  }

  /** Run a purge cycle. */
  private runPurge(messageDB: RelayDB, dmDB: DMDB): void {
    if (this.config.tier === 'main' && this.config.defaultRetentionDays === 0) {
      // Main nodes with permanent retention — nothing to purge
      return;
    }

    const retentionDays = this.config.defaultRetentionDays;
    if (retentionDays <= 0) return; // permanent

    const cutoffTs = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    let purgedMessages = 0;
    let purgedDMs = 0;

    try {
      // Purge messages from non-hosted communities
      const hostedSet = new Set(this.config.hostedCommunityIds);
      purgedMessages = messageDB.purgeOlderThan(cutoffTs, hostedSet);
    } catch (err) {
      console.error('[tier] Purge messages error:', err);
    }

    // DMs: respect per-user overrides (future), for now purge based on global retention
    // Note: DM purge is more sensitive — skip for now, only purge community messages

    if (purgedMessages > 0 || purgedDMs > 0) {
      console.log(`[tier] Purged: ${purgedMessages} messages, ${purgedDMs} DMs (older than ${retentionDays}d)`);
    }
  }

  // =================================================================
  // Storage stats
  // =================================================================

  getStorageStats(messageDB: RelayDB, dmDB: DMDB, communityDB: CommunityDB): StorageStats {
    const allCommunities = communityDB.getAllCommunityIds();
    const hostedSet = new Set(this.config.hostedCommunityIds);

    return {
      tier: this.config.tier,
      totalMessages: messageDB.getMessageCount(),
      totalDMs: dmDB.getCount(),
      totalFiles: 0, // placeholder
      fileSizeKB: 0,
      hostedCommunities: this.config.tier === 'main' ? allCommunities.length : hostedSet.size,
      cachedCommunities: this.config.tier === 'main' ? 0 : allCommunities.length - hostedSet.size,
      oldestMessage: 0, // placeholder
      retentionDays: this.config.defaultRetentionDays,
    };
  }

  /** Get tier info for PEX handshake. */
  getPexTierInfo(): { tier: NodeTier; hostedCommunityCount: number; uptimePercent: number; retentionDays: number } {
    return {
      tier: this.config.tier,
      hostedCommunityCount: this.config.hostedCommunityIds.length,
      uptimePercent: 0, // filled by caller
      retentionDays: this.config.defaultRetentionDays,
    };
  }
}
