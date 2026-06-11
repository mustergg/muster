/**
 * Admin Bot — R16
 *
 * Processes admin commands sent via the DM interface.
 * The bot appears as a special contact with publicKey = NODE_BOT_KEY.
 * Only the configured admin can interact with the bot.
 *
 * Commands:
 *   /help         — List available commands
 *   /status       — Node stats (uptime, connections, communities, peers, disk)
 *   /peers        — List connected and known peers
 *   /communities  — List hosted communities with member counts
 *   /users        — List registered users with tiers
 *   /config       — View node configuration
 *   /config set <key> <value> — Change a config value
 *   /purge <communityId> <days> — Delete messages older than N days
 *   /restart      — Restart the node (with confirmation)
 */

import { NodeDB } from './nodeDB';
import { RelayDB } from './database';
import { CommunityDB } from './communityDB';
import { DMDB } from './dmDB';
import { UserDB } from './userDB';
import { FileDB } from './fileDB';
import { PostDB } from './postDB';
import { SquadDB } from './squadDB';
import { TierManager } from './nodeTier';
import { BlobDB } from './blobDB';
import type { RelayClient } from './types';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import { freemem, totalmem, uptime as osUptime, hostname, platform, arch } from 'os';
import { getCurrentVersion, getGitBranch, getGitCommit, checkForUpdates, executeUpdate, compareVersions, autoconfigure } from './nodeUpdater';

/** Reserved public key for the node bot. */
export const NODE_BOT_KEY = '__NODE_BOT__';
export const NODE_BOT_USERNAME = 'Node Bot';

/** Tracks when the relay process started. */
const processStartTime = Date.now();

/** Pending restart confirmation (admin must send /restart confirm). */
let pendingRestart = false;

export class AdminBot {
  private nodeDB: NodeDB;
  private messageDB: RelayDB;
  private communityDB: CommunityDB;
  private dmDB: DMDB;
  private userDB: UserDB;
  private fileDB: FileDB;
  private postDB: PostDB;
  private squadDB: SquadDB;
  private tierManager: TierManager;
  private blobDB: BlobDB;
  private sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void;
  private getClientCount: () => number;
  private getChannelCount: () => number;
  private getPeerCount: () => number;
  private getPeerVersions: () => Array<{ nodeId: string; name: string; url: string; version: string }>;

  /** Monotonic timestamp for bot replies (skew-proof ordering vs questions). */
  private lastReplyTs = 0;
  /** Public keys already sent the welcome this process — avoids re-spamming
   *  on every DM_CONVERSATIONS_REQUEST. */
  private welcomed = new Set<string>();

  constructor(deps: {
    nodeDB: NodeDB;
    messageDB: RelayDB;
    communityDB: CommunityDB;
    dmDB: DMDB;
    userDB: UserDB;
    fileDB: FileDB;
    postDB: PostDB;
    squadDB: SquadDB;
    tierManager: TierManager;
    blobDB: BlobDB;
    sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void;
    getClientCount: () => number;
    getChannelCount: () => number;
    getPeerCount: () => number;
    getPeerVersions: () => Array<{ nodeId: string; name: string; url: string; version: string }>;
  }) {
    this.nodeDB = deps.nodeDB;
    this.messageDB = deps.messageDB;
    this.communityDB = deps.communityDB;
    this.dmDB = deps.dmDB;
    this.userDB = deps.userDB;
    this.fileDB = deps.fileDB;
    this.postDB = deps.postDB;
    this.squadDB = deps.squadDB;
    this.tierManager = deps.tierManager;
    this.blobDB = deps.blobDB;
    this.sendToClient = deps.sendToClient;
    this.getClientCount = deps.getClientCount;
    this.getChannelCount = deps.getChannelCount;
    this.getPeerCount = deps.getPeerCount;
    this.getPeerVersions = deps.getPeerVersions;
  }

  // =================================================================
  // Admin check
  // =================================================================

  /** 48h ownership-handover window (two owners; then it finalizes). */
  private static readonly HANDOVER_MS = 48 * 60 * 60 * 1000;

  /** Finalize a pending handover once its 48h window has elapsed: the pending
   *  owner becomes the sole owner. Idempotent — safe to call on every check. */
  private resolveOwnership(): void {
    const pending = this.nodeDB.getConfig('pendingOwner');
    const sinceStr = this.nodeDB.getConfig('pendingOwnerSince');
    if (!pending || !sinceStr) return;
    const since = parseInt(sinceStr) || 0;
    if (Date.now() - since >= AdminBot.HANDOVER_MS) {
      this.nodeDB.setConfig('adminPublicKey', pending);
      this.nodeDB.setConfig('pendingOwner', '');
      this.nodeDB.setConfig('pendingOwnerSince', '');
      console.log(`[admin-bot] Ownership handover finalized → ${pending.slice(0, 16)}...`);
    }
  }

  /** Check if a public key may use the bot. During a handover window BOTH the
   *  previous owner and the pending owner have access. */
  isAdmin(publicKey: string): boolean {
    this.resolveOwnership();
    const adminKey = this.nodeDB.getConfig('adminPublicKey');
    if (!adminKey) return true; // first user to message the bot claims it
    if (publicKey === adminKey) return true;
    // Co-owner during the 48h handover window (resolveOwnership already
    // promoted it if the window had elapsed).
    const pending = this.nodeDB.getConfig('pendingOwner');
    if (pending && publicKey === pending && this.nodeDB.getConfig('pendingOwnerSince')) return true;
    return false;
  }

  /** Set the admin public key (first-time setup). */
  private ensureAdmin(publicKey: string): void {
    const existing = this.nodeDB.getConfig('adminPublicKey');
    if (!existing) {
      this.nodeDB.setConfig('adminPublicKey', publicKey);
      console.log(`[admin-bot] Admin configured: ${publicKey.slice(0, 16)}...`);
    }
  }

  // =================================================================
  // Message handling
  // =================================================================

  /** Process an incoming DM to the bot. Returns true if handled. */
  handleMessage(client: RelayClient, content: string, incomingTs?: number): void {
    // Ensure replies sort AFTER the user's question even when the relay's
    // clock lags the client's (clock skew between machines). Base the reply
    // timestamps on the incoming message's client timestamp.
    if (typeof incomingTs === 'number' && incomingTs > this.lastReplyTs) {
      this.lastReplyTs = incomingTs;
    }
    // Auto-configure admin on first interaction
    this.ensureAdmin(client.publicKey);

    if (!this.isAdmin(client.publicKey)) {
      this.reply(client, '⛔ Access denied. Only the node admin can interact with this bot.');
      return;
    }

    const trimmed = content.trim();
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0]?.toLowerCase() || '';

    switch (cmd) {
      case '/help':       this.cmdHelp(client); break;
      case '/status':     this.cmdStatus(client); break;
      case '/peers':      this.cmdPeers(client); break;
      case '/communities': this.cmdCommunities(client); break;
      case '/users':      this.cmdUsers(client); break;
      case '/config':     this.cmdConfig(client, parts.slice(1)); break;
      case '/purge':      this.cmdPurge(client, parts.slice(1)); break;
      case '/restart':    this.cmdRestart(client, parts.slice(1)); break;
      case '/version':    this.cmdVersion(client); break;
      case '/owner':      this.cmdOwner(client, parts.slice(1)); break;
      case '/host':       this.cmdHost(client, parts.slice(1)); break;
      case '/storage':    this.cmdStorage(client, parts.slice(1)); break;
      case '/update':     this.cmdUpdate(client, parts.slice(1)); break;
      default:
        if (trimmed.startsWith('/')) {
          this.reply(client, `❓ Unknown command: ${cmd}\nType /help for available commands.`);
        } else {
          this.reply(client, `👋 Hi! I'm your node bot.\nType /help to see what I can do.`);
        }
    }
  }

  // =================================================================
  // Commands
  // =================================================================

  private cmdHelp(client: RelayClient): void {
    this.reply(client, [
      '📋 Node Bot — Commands',
      '━━━━━━━━━━━━━━━━━━━━',
      '📊 Info',
      '  /status            — Uptime, connections, data, memory',
      '  /version           — This node + peer versions',
      '  /peers             — Connected and known peers',
      '  /communities       — Hosted communities with stats',
      '  /users             — Registered user counts',
      '',
      '⚙️ Config',
      '  /owner             — Owner / handover (set <user> · refuse; 48h, verified only)',
      '  /config            — View node configuration',
      '  /config set <key> <value> — Change a setting',
      '    keys: nodeName, retentionDays, maxFileSize, pnpmPath, gitPath, nodePath',
      '    e.g. /config set nodeName My Node',
      '    e.g. /config set pnpmPath /home/pi/.local/share/pnpm/pnpm',
      '',
      '🏠 Hosting & Storage',
      '  /host              — Hosted communities (mine · add · stop · retention · reset)',
      '  /storage           — Usage + limit/network share (limit <MB> · network <pct>)',
      '',
      '🔄 Maintenance',
      '  /update autoconf   — Detect + save tool paths (git, node, pnpm)',
      '  /update check      — Check remote for updates (git fetch)',
      '  /update confirm    — Update now (git pull + install + build + restart)',
      '  /purge <days>      — Delete messages older than N days (whole node)',
      '  /restart           — Restart the node (/restart confirm)',
      '',
      '  /help              — This message',
    ].join('\n'));
  }

  private cmdStatus(client: RelayClient): void {
    const uptimeMs = Date.now() - processStartTime;
    const uptimeStr = formatUptime(uptimeMs);
    const nodeId = this.nodeDB.getNodeId();
    const nodeName = this.nodeDB.getNodeName();
    const uc = this.userDB.getUserCount();
    const fileSizeKB = Math.round(this.fileDB.getTotalSize() / 1024);
    const memFree = Math.round(freemem() / 1024 / 1024);
    const memTotal = Math.round(totalmem() / 1024 / 1024);
    const version = getCurrentVersion();
    const branch = getGitBranch();
    const commit = getGitCommit();
    const lastUpdate = this.nodeDB.getConfig('lastUpdate') || 'never';

    this.reply(client, [
      `🖥️ Node Status`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `Name:          ${nodeName}`,
      `Node ID:       ${nodeId.slice(0, 20)}...`,
      `Version:       ${version} (${branch}@${commit})`,
      `Last update:   ${lastUpdate}`,
      `Platform:      ${platform()} ${arch()}`,
      `Hostname:      ${hostname()}`,
      `Uptime:        ${uptimeStr}`,
      ``,
      `📊 Data`,
      `Connections:   ${this.getClientCount()}`,
      `Channels:      ${this.getChannelCount()}`,
      `Communities:   ${this.communityDB.getCommunityCount()}`,
      `Messages:      ${this.messageDB.getMessageCount()}`,
      `DMs:           ${this.dmDB.getCount()}`,
      `Files:         ${this.fileDB.getCount()} (${fileSizeKB} KB)`,
      `Squads:        ${this.squadDB.getSquadCount()}`,
      `Users:         ${uc.total} (${uc.verified}v / ${uc.basic}b)`,
      ``,
      `🌐 Network`,
      `Known peers:   ${this.nodeDB.getPeerCount()}`,
      `Connected:     ${this.getPeerCount()}`,
      ``,
      `💾 Storage`,
      ...this.storageStatusLines(),
      ``,
      `💾 Memory`,
      `Free:          ${memFree} MB / ${memTotal} MB`,
    ].join('\n'));
  }

  /** Storage usage lines shared by /status and /storage (incl. 90% alert). */
  private storageStatusLines(): string[] {
    const cfg = this.tierManager.getConfig();
    const usedMB = (this.blobDB.stats().totalBytes + this.fileDB.getTotalSize()) / (1024 * 1024);
    const maxMB = cfg.maxDiskMB;
    const lines = [
      `Used:          ${usedMB.toFixed(1)} MB`,
      `Limit:         ${maxMB === 0 ? 'unlimited' : maxMB + ' MB'}`,
      `Hosting:       ${this.tierManager.getConfig().hostedCommunityIds.length} communities (selective)`,
    ];
    if (maxMB > 0) {
      const pct = Math.round((usedMB / maxMB) * 100);
      lines.push(`Usage:         ${pct}%${pct >= 90 ? '  🚨 OVER 90% — raise /storage limit or free space' : ''}`);
    }
    return lines;
  }

  private cmdPeers(client: RelayClient): void {
    const peers = this.nodeDB.getAllPeers();
    if (peers.length === 0) {
      this.reply(client, '🌐 No known peers.\nAdd peers via SEED_NODES in peerManager.ts or manually via sqlite3.');
      return;
    }

    const lines = ['🌐 Known Peers:', '━━━━━━━━━━━━━━━━━━━━'];
    for (const p of peers) {
      const ago = formatUptime(Date.now() - p.lastSeen);
      const communities = JSON.parse(p.communityIds || '[]').length;
      lines.push(`• ${p.name || p.nodeId.slice(0, 16)}`);
      lines.push(`  URL: ${p.url}`);
      lines.push(`  Last seen: ${ago} ago | Communities: ${communities}`);
      lines.push('');
    }
    lines.push(`Total: ${peers.length} peers`);
    this.reply(client, lines.join('\n'));
  }

  private cmdCommunities(client: RelayClient): void {
    const ids = this.communityDB.getAllCommunityIds();
    if (ids.length === 0) {
      this.reply(client, '🏘️ No communities hosted on this node.');
      return;
    }

    const lines = ['🏘️ Hosted Communities:', '━━━━━━━━━━━━━━━━━━━━'];
    for (const id of ids) {
      const c = this.communityDB.getCommunity(id);
      if (!c) continue;
      const members = this.communityDB.getMembers(id);
      const channels = this.communityDB.getChannels(id);
      lines.push(`• ${c.name}`);
      lines.push(`  ID: ${id.slice(0, 16)}...`);
      lines.push(`  Members: ${members.length} | Channels: ${channels.length}`);
      lines.push('');
    }
    lines.push(`Total: ${ids.length} communities`);
    this.reply(client, lines.join('\n'));
  }

  private cmdUsers(client: RelayClient): void {
    const uc = this.userDB.getUserCount();
    const lines = [
      '👥 Registered Users:',
      '━━━━━━━━━━━━━━━━━━━━',
      `Total:     ${uc.total}`,
      `Verified:  ${uc.verified}`,
      `Basic:     ${uc.basic}`,
    ];
    this.reply(client, lines.join('\n'));
  }

  private cmdConfig(client: RelayClient, args: string[]): void {
    if (args[0] === 'set' && args.length >= 3) {
      const key = args[1]!;
      const value = args.slice(2).join(' ');
      const allowed = ['nodeName', 'retentionDays', 'maxFileSize', 'adminPublicKey', 'pnpmPath', 'gitPath', 'nodePath', 'serviceName'];
      if (!allowed.includes(key)) {
        this.reply(client, `❌ Unknown config key: ${key}\nAllowed: ${allowed.join(', ')}`);
        return;
      }
      this.nodeDB.setConfig(key, value);
      if (key === 'nodeName') this.nodeDB.setNodeName(value);
      this.reply(client, `✅ Config updated: ${key} = ${value}`);
      return;
    }

    // Show current config
    const nodeName = this.nodeDB.getNodeName();
    const retention = this.nodeDB.getConfig('retentionDays') || '30';
    const maxFile = this.nodeDB.getConfig('maxFileSize') || '1048576';
    const adminKey = this.nodeDB.getConfig('adminPublicKey') || 'not set';
    const pnpmPath = this.nodeDB.getConfig('pnpmPath') || 'auto-detect';
    const gitPath = this.nodeDB.getConfig('gitPath') || 'auto-detect';
    const nodePath = this.nodeDB.getConfig('nodePath') || 'auto-detect';

    this.reply(client, [
      '⚙️ Node Configuration:',
      '━━━━━━━━━━━━━━━━━━━━',
      `nodeName:       ${nodeName}`,
      `retentionDays:  ${retention}`,
      `maxFileSize:    ${maxFile} bytes (${Math.round(parseInt(maxFile) / 1024)} KB)`,
      `adminPublicKey: ${adminKey.slice(0, 20)}...`,
      `pnpmPath:       ${pnpmPath}`,
      `gitPath:        ${gitPath}`,
      `nodePath:       ${nodePath}`,
      '',
      'To change: /config set <key> <value>',
      'Auto-detect tool paths: /update autoconf',
    ].join('\n'));
  }

  /** Show or transfer relay ownership.
   *
   *  Transfer is a 48h handover, not an instant swap:
   *    - The new owner must be a VERIFIED account.
   *    - During the 48h both the previous and new owner have bot access.
   *    - The new (pending) owner can't transfer onward until the window ends.
   *    - Either party can `/owner refuse` to cancel and revert to the previous
   *      sole owner.
   *  After 48h the pending owner becomes sole owner (the previous one loses
   *  access). Finalization is lazy — see resolveOwnership(). */
  private cmdOwner(client: RelayClient, args: string[]): void {
    this.resolveOwnership();
    const current = this.nodeDB.getConfig('adminPublicKey');
    const pending = this.nodeDB.getConfig('pendingOwner');
    const since = parseInt(this.nodeDB.getConfig('pendingOwnerSince') || '0') || 0;
    const hoursLeft = pending ? Math.max(0, Math.ceil((AdminBot.HANDOVER_MS - (Date.now() - since)) / (60 * 60 * 1000))) : 0;

    if (!args[0]) {
      const cu = current ? this.userDB.getUser(current) : undefined;
      const lines = [
        '👑 Relay Owner',
        '━━━━━━━━━━━━━━━━━━━━',
        current ? `Owner: ${cu?.username || '(unknown user)'}` : 'Owner: not set (first to message the bot claims it)',
        ...(current ? [`Key:   ${current.slice(0, 24)}...`] : []),
      ];
      if (pending) {
        const nu = this.userDB.getUser(pending);
        lines.push('', `🤝 Handover in progress → ${nu?.username || '(unknown)'} (co-owner)`);
        lines.push(`   Becomes sole owner in ${hoursLeft}h. /owner refuse to cancel.`);
      }
      lines.push('', 'Transfer:  /owner set <username|publicKeyHex>');
      lines.push('Cancel:    /owner refuse');
      this.reply(client, lines.join('\n'));
      return;
    }

    if (args[0] === 'refuse' || args[0] === 'cancel') {
      if (!pending) { this.reply(client, 'ℹ️ No pending handover to cancel.'); return; }
      this.nodeDB.setConfig('pendingOwner', '');
      this.nodeDB.setConfig('pendingOwnerSince', '');
      const cu = current ? this.userDB.getUser(current) : undefined;
      console.log(`[admin-bot] Ownership handover refused by ${client.username}`);
      this.reply(client, `✅ Handover cancelled. ${cu?.username || 'The previous owner'} remains the sole owner.`);
      return;
    }

    if (args[0] === 'set' && args[1]) {
      // The pending (new) owner can't re-transfer until the window completes.
      if (pending && client.publicKey === pending) {
        this.reply(client, `⏳ You can't transfer ownership until the 48h handover completes (${hoursLeft}h left).`);
        return;
      }
      if (pending) {
        this.reply(client, '⏳ A handover is already in progress. Cancel it with /owner refuse first.');
        return;
      }

      const target = args[1].trim();
      let user;
      if (/^[0-9a-fA-F]{64}$/.test(target)) {
        user = this.userDB.getUser(target);
        if (!user) { this.reply(client, '❌ No registered user has that public key.'); return; }
      } else {
        user = this.userDB.getUserByUsername(target);
        if (!user) { this.reply(client, `❌ User "${target}" not found. They must have logged into this node at least once.`); return; }
      }

      if (user.publicKey === current) { this.reply(client, `ℹ️ ${user.username} is already the owner.`); return; }
      if (!this.userDB.isVerified(user.publicKey)) {
        this.reply(client, `❌ ${user.username} must be a verified account before they can become owner.`);
        return;
      }

      this.nodeDB.setConfig('pendingOwner', user.publicKey);
      this.nodeDB.setConfig('pendingOwnerSince', String(Date.now()));
      console.log(`[admin-bot] Ownership handover started: ${client.username} → ${user.username} (${user.publicKey.slice(0, 16)}...)`);
      this.reply(client, [
        `🤝 Ownership handover started → ${user.username}.`,
        '',
        'For the next 48h the relay has TWO owners (you + them).',
        'After 48h they become the sole owner and you lose bot access.',
        'They cannot transfer it onward until then.',
        '',
        'Changed your mind? /owner refuse — reverts to you as sole owner.',
      ].join('\n'));
      return;
    }

    this.reply(client, 'Usage:\n  /owner                              — show owner / handover status\n  /owner set <username|publicKeyHex>  — start a 48h handover (new owner must be verified)\n  /owner refuse                       — cancel a pending handover');
  }

  /** Resolve a community by exact id or (case-insensitive) name. */
  private resolveCommunity(input: string): { id: string; name: string; ownerPublicKey: string } | undefined {
    const direct = this.communityDB.getCommunity(input);
    if (direct) return direct as any;
    const needle = input.trim().toLowerCase();
    for (const id of this.communityDB.getAllCommunityIds()) {
      const c = this.communityDB.getCommunity(id) as any;
      if (c && String(c.name).toLowerCase() === needle) return c;
    }
    return undefined;
  }

  /** Manage which communities this relay hosts. */
  private cmdHost(client: RelayClient, args: string[]): void {
    const owner = this.nodeDB.getConfig('adminPublicKey');
    const cfg = this.tierManager.getConfig();
    const sub = (args[0] || '').toLowerCase();

    if (!sub || sub === 'list') {
      const lines = ['🏠 Hosted Communities', '━━━━━━━━━━━━━━━━━━━━',
        'Hosting is selective: only your own + added communities.', ''];
      if (cfg.hostedCommunityIds.length === 0) {
        lines.push('No communities hosted yet. Add one: /host add <name>');
      } else {
        for (const id of cfg.hostedCommunityIds) {
          const c = this.communityDB.getCommunity(id) as any;
          if (!c) continue;
          const ret = this.tierManager.getRetentionDays(id);
          const mine = c.ownerPublicKey === owner ? ' (yours)' : '';
          lines.push(`• ${c.name}${mine} — ${ret === 0 ? 'permanent' : ret + 'd'}`);
        }
      }
      this.reply(client, lines.join('\n'));
      return;
    }

    if (sub === 'mine') {
      const mine = owner ? (this.communityDB.getCommunitiesForUser(owner) as any[]) : [];
      const lines = ['👤 Your Communities', '━━━━━━━━━━━━━━━━━━━━'];
      if (mine.length === 0) lines.push('You are not in any community on this node.');
      for (const c of mine) {
        const hosted = this.tierManager.isHosted(c.id);
        const role = c.ownerPublicKey === owner ? 'owner' : 'member';
        lines.push(`• ${c.name} [${role}] ${hosted ? '✓ hosted' : '— not hosted'}`);
      }
      lines.push('', 'Host one: /host add <name>');
      this.reply(client, lines.join('\n'));
      return;
    }

    if (sub === 'reset') {
      // Drop everything except the owner's own communities (one-shot prune of an
      // inherited host-all list). Non-owned communities get purged after their
      // retention window.
      const cfg2 = this.tierManager.getConfig();
      const dropped: string[] = [];
      for (const id of [...cfg2.hostedCommunityIds]) {
        const c = this.communityDB.getCommunity(id) as any;
        if (!c || c.ownerPublicKey !== owner) { this.tierManager.unhostCommunity(id); if (c) dropped.push(c.name); }
      }
      this.tierManager.syncOwnerCommunities(this.communityDB, owner);
      this.reply(client, `✅ Reset to your own communities only. Stopped hosting ${dropped.length} other(s)${dropped.length ? ': ' + dropped.slice(0, 10).join(', ') : ''}.\nThey'll be purged after their retention window.`);
      return;
    }

    if (sub === 'add' && args[1]) {
      const c = this.resolveCommunity(args.slice(1).join(' '));
      if (!c) { this.reply(client, '❌ Community not found (use its exact name or id).'); return; }
      this.tierManager.hostCommunity(c.id);
      this.reply(client, `✅ Now hosting "${c.name}".`);
      return;
    }

    if (sub === 'stop' && args[1]) {
      const c = this.resolveCommunity(args.slice(1).join(' '));
      if (!c) { this.reply(client, '❌ Community not found.'); return; }
      if (c.ownerPublicKey === owner) { this.reply(client, `❌ You can't stop hosting "${c.name}" — you own it.`); return; }
      this.tierManager.unhostCommunity(c.id);
      this.reply(client, `✅ Stopped hosting "${c.name}". It will be purged after its retention window.`);
      return;
    }

    if (sub === 'retention' && args.length >= 3) {
      const days = parseInt(args[args.length - 1]);
      const name = args.slice(1, args.length - 1).join(' ');
      const c = this.resolveCommunity(name);
      if (!c) { this.reply(client, '❌ Community not found.'); return; }
      if (isNaN(days) || days < 0) { this.reply(client, '❌ Days must be a number ≥ 0 (0 = permanent).'); return; }
      this.tierManager.setCommunityRetention(c.id, days);
      this.reply(client, `✅ "${c.name}" will be kept for ${days === 0 ? 'permanent' : days + ' days'}.`);
      return;
    }

    this.reply(client, [
      '🏠 Host commands (hosting is always selective):',
      '  /host                       — list hosted communities',
      '  /host mine                  — your communities + hosted status',
      '  /host add <name>            — host a community',
      '  /host stop <name>           — stop hosting (not your own)',
      '  /host retention <name> <days> — keep N days (0 = permanent)',
      '  /host reset                 — host only your own (drop the rest)',
    ].join('\n'));
  }

  /** Show + manage relay storage limits and the network contribution share. */
  private cmdStorage(client: RelayClient, args: string[]): void {
    const cfg = this.tierManager.getConfig();
    const usedBytes = this.blobDB.stats().totalBytes + this.fileDB.getTotalSize();
    const usedMB = usedBytes / (1024 * 1024);
    const maxMB = cfg.maxDiskMB; // 0 = unlimited
    const netPct = cfg.networkContributionPercent;
    const sub = (args[0] || '').toLowerCase();

    if (!sub || sub === 'status') {
      const lines = ['💾 Storage', '━━━━━━━━━━━━━━━━━━━━',
        `Used:  ${usedMB.toFixed(1)} MB`,
        `Limit: ${maxMB === 0 ? 'unlimited' : maxMB + ' MB'}`];
      if (maxMB > 0) {
        const pct = Math.round((usedMB / maxMB) * 100);
        lines.push(`Usage: ${pct}%`);
        if (pct >= 90) lines.push('🚨 Over 90%! Raise the limit (/storage limit <MB>) or free up space.');
        lines.push(`Network share: ${netPct}% → up to ${(maxMB * netPct / 100).toFixed(0)} MB (grows in parallel with your own usage)`);
      } else {
        lines.push(`Network share: ${netPct}%`);
      }
      lines.push('', '/storage limit <MB>            — set disk limit (0 = unlimited)', '/storage network <pct> [--force] — network share (min 10%)');
      this.reply(client, lines.join('\n'));
      return;
    }

    if (sub === 'limit' && args[1] !== undefined) {
      const mb = parseInt(args[1]);
      if (isNaN(mb) || mb < 0) { this.reply(client, '❌ MB must be a number ≥ 0 (0 = unlimited).'); return; }
      this.tierManager.setLimits({ maxDiskMB: mb });
      this.reply(client, `✅ Disk limit set to ${mb === 0 ? 'unlimited' : mb + ' MB'}.`);
      return;
    }

    if (sub === 'network' && args[1] !== undefined) {
      const pct = parseInt(args[1]);
      const force = args.includes('--force');
      if (isNaN(pct) || pct < 0 || pct > 100) { this.reply(client, '❌ Percent must be 0–100.'); return; }
      if (pct < 10 && !force) {
        this.reply(client, [
          '⚠️ Less than 10% network share weakens the wider Muster network.',
          'If you really need to, please support the project another way —',
          'a small donation goes a long way 🙏.',
          '',
          `To proceed anyway: /storage network ${pct} --force`,
        ].join('\n'));
        return;
      }
      this.tierManager.setLimits({ networkContributionPercent: pct });
      this.reply(client, `✅ Network share set to ${pct}%.${pct < 10 ? '\nThank you for considering a donation 🙏' : ''}`);
      return;
    }

    this.reply(client, [
      '💾 Storage commands:',
      '  /storage                       — usage + limits',
      '  /storage limit <MB>            — disk limit (0 = unlimited)',
      '  /storage network <pct> [--force] — network share % (min 10%)',
    ].join('\n'));
  }

  private cmdPurge(client: RelayClient, args: string[]): void {
    if (args.length < 1) {
      this.reply(client, '❌ Usage: /purge <days>\nDeletes all messages older than <days> days across the entire node.');
      return;
    }

    const days = parseInt(args[0]!);
    if (isNaN(days) || days < 1) {
      this.reply(client, '❌ Days must be a positive number.');
      return;
    }

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const deleted = this.messageDB.deleteOlderThan(cutoff);
    this.reply(client, `🗑️ Purged ${deleted} messages older than ${days} days.`);
  }

  private cmdRestart(client: RelayClient, args: string[]): void {
    if (args[0] === 'confirm') {
      if (!pendingRestart) {
        this.reply(client, '❌ No pending restart. Type /restart first.');
        return;
      }
      pendingRestart = false;
      this.reply(client, '🔄 Restarting node in 3 seconds...');
      setTimeout(() => {
        console.log('[admin-bot] Restart requested by admin.');
        process.exit(1); // non-zero so Restart=on-failure/always restarts us
      }, 3000);
      return;
    }

    pendingRestart = true;
    setTimeout(() => { pendingRestart = false; }, 30000); // Expires after 30s

    this.reply(client, [
      '⚠️ Restart Confirmation',
      '━━━━━━━━━━━━━━━━━━━━',
      'This will disconnect all users and restart the node.',
      'The node will be back online within seconds (systemd auto-restart).',
      '',
      'Type /restart confirm within 30 seconds to proceed.',
    ].join('\n'));
  }

  // =================================================================
  // Version & Update commands (R17)
  // =================================================================

  private cmdVersion(client: RelayClient): void {
    const version = getCurrentVersion();
    const branch = getGitBranch();
    const commit = getGitCommit();
    const lastUpdate = this.nodeDB.getConfig('lastUpdate') || 'never';
    const lastCommit = this.nodeDB.getConfig('lastUpdateCommit') || 'N/A';
    const peerVersions = this.getPeerVersions();

    const lines = [
      '📦 Version Info',
      '━━━━━━━━━━━━━━━━━━━━',
      `This node:     ${version} (${branch}@${commit})`,
      `Last update:   ${lastUpdate}`,
      `Last commit:   ${lastCommit}`,
      '',
    ];

    if (peerVersions.length > 0) {
      lines.push('🌐 Peer Versions:');
      let newerFound = false;
      for (const p of peerVersions) {
        const cmp = compareVersions(p.version, version);
        const indicator = cmp > 0 ? ' ⬆️ NEWER' : cmp < 0 ? ' ⬇️ older' : ' ✓ same';
        lines.push(`  • ${p.name || p.nodeId.slice(0, 12)}: ${p.version}${indicator}`);
        if (cmp > 0) newerFound = true;
      }
      lines.push('');
      if (newerFound) {
        lines.push('⚠️ A newer version is available! Use /update check for details.');
      } else {
        lines.push('✅ You are running the latest version.');
      }
    } else {
      lines.push('No peers connected — cannot compare versions.');
    }

    this.reply(client, lines.join('\n'));
  }

  private async cmdUpdate(client: RelayClient, args: string[]): Promise<void> {
    if (args[0] === 'autoconf') {
      this.reply(client, '🔧 Detecting update toolchain (git, node, pnpm)...');
      try {
        const res = autoconfigure(this.nodeDB);
        this.reply(client, res.log.join('\n'));
      } catch (err: any) {
        this.reply(client, `❌ Autoconf failed: ${err.message || 'Unknown error'}`);
      }
      return;
    }

    if (args[0] === 'check') {
      this.reply(client, '🔍 Checking for updates...');
      const result = checkForUpdates();

      if (result.error) {
        this.reply(client, `❌ Update check failed: ${result.error}`);
        return;
      }

      if (result.available) {
        this.reply(client, [
          `⬆️ Update Available!`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `Branch: ${result.branch}`,
          `Commits behind: ${result.behind}`,
          ``,
          `To update, type: /update confirm`,
          `This will: git pull → pnpm install → rebuild → restart`,
        ].join('\n'));
      } else {
        this.reply(client, [
          `✅ Up to date!`,
          `Branch: ${result.branch}`,
          `No new commits on remote.`,
        ].join('\n'));
      }
      return;
    }

    if (args[0] === 'confirm') {
      this.reply(client, [
        '🔄 Starting update process...',
        'This may take 1-2 minutes. The node will restart automatically when done.',
        '',
        'Steps: git pull → pnpm install → build packages → build relay → restart',
      ].join('\n'));

      try {
        const result = await executeUpdate(this.nodeDB);

        // Send the log to admin
        this.reply(client, result.log.join('\n'));

        if (result.success) {
          // Stash a post-restart report so the owner gets a confirmation (with
          // recent logs) the next time they connect after the node comes back.
          this.nodeDB.setConfig('updateReport', JSON.stringify({
            owner: client.publicKey,
            version: getCurrentVersion(),
            commit: getGitCommit(),
            at: Date.now(),
          }));
          // Schedule restart. Exit non-zero so the common `Restart=on-failure`
          // systemd policy restarts us (a clean exit 0 would NOT trigger it).
          setTimeout(() => {
            console.log('[updater] Update complete. Restarting...');
            process.exit(1); // systemd (on-failure/always) restarts the service
          }, 3000);
        }
      } catch (err: any) {
        this.reply(client, `❌ Update failed: ${err.message || 'Unknown error'}`);
      }
      return;
    }

    // No subcommand — show usage
    this.reply(client, [
      '📦 Update Commands:',
      '',
      '/update autoconf — Detect + save tool paths (git, node, pnpm)',
      '/update check    — Check if updates are available (git fetch)',
      '/update confirm  — Execute update (git pull + rebuild + restart)',
      '',
      'Run /update autoconf once after setup (or if /update can\'t find pnpm).',
      `Current version: ${getCurrentVersion()} (${getGitBranch()}@${getGitCommit()})`,
    ].join('\n'));
  }

  // =================================================================
  // Send welcome message when admin connects
  // =================================================================

  /** Tail the systemd journal for this service (best-effort — needs journal
   *  access; falls back to a note when unavailable). */
  private tailJournal(lines = 25): string {
    const unit = this.nodeDB.getConfig('serviceName') || 'muster-node';
    try {
      const out = execSync(`journalctl -u ${unit} -n ${lines} --no-pager -o short`, { encoding: 'utf-8', timeout: 8000 }).trim();
      // Keep the DM compact — last ~1500 chars.
      return out.length > 1500 ? '…\n' + out.slice(-1500) : out;
    } catch {
      return '(journal unavailable — the service user needs journal access:\n  sudo usermod -aG systemd-journal <user> && reboot )';
    }
  }

  /** After an update-triggered restart, DM the owner a confirmation with the
   *  new version + recent logs. Sent once, when the owner next connects. */
  sendUpdateReportIfPending(client: RelayClient): void {
    const raw = this.nodeDB.getConfig('updateReport');
    if (!raw) return;
    if (!this.isAdmin(client.publicKey)) return; // owner only
    let rep: any;
    try { rep = JSON.parse(raw); } catch { this.nodeDB.setConfig('updateReport', ''); return; }
    this.nodeDB.setConfig('updateReport', ''); // deliver once

    const journal = this.tailJournal();
    this.reply(client, [
      '✅ Node restarted after update',
      '━━━━━━━━━━━━━━━━━━━━',
      `Now running: ${rep.version || getCurrentVersion()} (${rep.commit || getGitCommit()})`,
      `Updated at:  ${rep.at ? new Date(rep.at).toISOString() : 'unknown'}`,
      '',
      '📜 Recent log (journalctl -u muster-node):',
      journal,
    ].join('\n'));
  }

  sendWelcome(client: RelayClient): void {
    // Send at most once per process per admin — the dispatcher calls this on
    // every DM_CONVERSATIONS_REQUEST, which previously stacked welcomes.
    if (this.welcomed.has(client.publicKey)) return;
    this.welcomed.add(client.publicKey);

    const version = getCurrentVersion();
    const commit = getGitCommit();
    const ts = this.nextReplyTs();
    this.sendToClient(client, {
      type: 'DM_MESSAGE',
      payload: {
        // Stable id so any re-send dedups on the client.
        messageId: 'bot-welcome',
        senderPublicKey: NODE_BOT_KEY,
        senderUsername: NODE_BOT_USERNAME,
        recipientPublicKey: client.publicKey,
        content: [
          `👋 Welcome, admin!`,
          `I'm your node bot (v${version} • ${commit}).`,
          `Type /help to see available commands.`,
          ``,
          `Quick: /status for stats, /version for update info.`,
        ].join('\n'),
        timestamp: ts,
      },
      timestamp: ts,
    });
  }

  /** Next monotonic reply timestamp (≥ now and ≥ last question/reply). */
  private nextReplyTs(): number {
    const t = Math.max(Date.now(), this.lastReplyTs + 1);
    this.lastReplyTs = t;
    return t;
  }

  // =================================================================
  // Reply helper
  // =================================================================

  private reply(client: RelayClient, content: string): void {
    const ts = this.nextReplyTs();
    this.sendToClient(client, {
      type: 'DM_MESSAGE',
      payload: {
        messageId: 'bot-' + randomBytes(8).toString('hex'),
        senderPublicKey: NODE_BOT_KEY,
        senderUsername: NODE_BOT_USERNAME,
        recipientPublicKey: client.publicKey,
        content,
        timestamp: ts,
      },
      timestamp: ts,
    });
  }
}

// =================================================================
// Helpers
// =================================================================

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
