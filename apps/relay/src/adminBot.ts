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
import type { RelayClient } from './types';
import { randomBytes } from 'crypto';
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
    this.sendToClient = deps.sendToClient;
    this.getClientCount = deps.getClientCount;
    this.getChannelCount = deps.getChannelCount;
    this.getPeerCount = deps.getPeerCount;
    this.getPeerVersions = deps.getPeerVersions;
  }

  // =================================================================
  // Admin check
  // =================================================================

  /** Check if a public key is the configured admin. */
  isAdmin(publicKey: string): boolean {
    const adminKey = this.nodeDB.getConfig('adminPublicKey');
    if (!adminKey) {
      // First user to message the bot becomes admin
      return true;
    }
    return adminKey === publicKey;
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
      '  /config            — View node configuration',
      '  /config set <key> <value> — Change a setting',
      '    keys: nodeName, retentionDays, maxFileSize, pnpmPath, gitPath, nodePath',
      '    e.g. /config set nodeName My Node',
      '    e.g. /config set pnpmPath /home/pi/.local/share/pnpm/pnpm',
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
      `💾 Memory`,
      `Free:          ${memFree} MB / ${memTotal} MB`,
    ].join('\n'));
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
      const allowed = ['nodeName', 'retentionDays', 'maxFileSize', 'adminPublicKey', 'pnpmPath', 'gitPath', 'nodePath'];
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
        process.exit(0); // systemd will restart the service
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
          // Schedule restart
          setTimeout(() => {
            console.log('[updater] Update complete. Restarting...');
            process.exit(0); // systemd restarts the service
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
