/**
 * Node Updater — R17
 *
 * Handles self-update via git pull + pnpm rebuild + restart.
 * Tracks version from package.json, compares with peer versions.
 */

import { execSync, exec } from 'child_process';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { NodeDB } from './nodeDB';

/** Read the current relay version from package.json. */
export function getCurrentVersion(): string {
  try {
    // Try multiple paths (running from dist/ or src/)
    const candidates = [
      join(process.cwd(), 'package.json'),
      join(process.cwd(), '..', 'package.json'),
      join(__dirname, '..', 'package.json'),
      join(__dirname, '..', '..', 'package.json'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        const pkg = JSON.parse(readFileSync(p, 'utf-8'));
        if (pkg.name === '@muster/relay' || pkg.name?.includes('relay')) {
          return pkg.version || '0.0.0';
        }
      }
    }
    // Fallback: try monorepo root
    const rootPkg = join(process.cwd(), '..', '..', 'package.json');
    if (existsSync(rootPkg)) {
      return JSON.parse(readFileSync(rootPkg, 'utf-8')).version || '0.0.0';
    }
  } catch { /* ignore */ }
  return '0.0.0';
}

/** Quote a command/path for the shell if it contains a path separator or space. */
function shellQuote(p: string): string {
  return p.includes(' ') || p.includes('/') ? `"${p}"` : p;
}

/** Verify a pnpm invocation actually runs. `cmd` may be quoted path or `corepack pnpm`. */
function pnpmWorks(cmd: string, cwd: string): boolean {
  try { execSync(`${cmd} --version`, { cwd, stdio: 'pipe', timeout: 20000 }); return true; }
  catch { return false; }
}

/** Find a pnpm command that actually runs in the service's environment.
 *
 *  Order: an admin-provided / previously-discovered value stored in node config
 *  (`pnpmPath`), then common absolute install locations, then a login shell's
 *  PATH, then corepack. The first working result is persisted to config so the
 *  next update is instant — and so the node admin can inspect/override it via
 *  the bot (`/config set pnpmPath <path>`). pnpm lives in different places on
 *  different servers, so this is intentionally configurable, not hardcoded. */
function resolvePnpmCmd(cwd: string, nodeDB?: NodeDB): string {
  const persist = (cmd: string): string => { try { nodeDB?.setConfig('pnpmPath', cmd); } catch { /* ignore */ } return cmd; };

  // 1. Admin-set / previously-discovered value (highest priority).
  const stored = nodeDB?.getConfig('pnpmPath');
  if (stored) {
    const cmd = stored.includes(' ') ? stored : shellQuote(stored); // 'corepack pnpm' has a space → use verbatim
    if (pnpmWorks(cmd, cwd)) return cmd;
  }

  // 2. Sibling of the node binary — nvm/fnm install pnpm next to node
  //    (e.g. ~/.nvm/versions/node/vX/bin/node → .../bin/pnpm). Most reliable
  //    when node was resolved but PATH lacks pnpm.
  const nodePath = nodeDB?.getConfig('nodePath') || process.execPath;
  if (nodePath) {
    const binDir = nodePath.replace(/[\\/][^\\/]*$/, ''); // dirname
    const sibling = `${binDir}/pnpm`;
    if (pnpmWorks(shellQuote(sibling), cwd)) return persist(shellQuote(sibling));
    // corepack ships next to node too
    const corepack = `${binDir}/corepack`;
    if (pnpmWorks(`${shellQuote(corepack)} pnpm`, cwd)) return persist(`${shellQuote(corepack)} pnpm`);
  }

  // 3. Common absolute locations.
  const home = process.env.HOME || process.env.USERPROFILE || '/home/pi';
  const direct = [
    `${home}/.local/share/pnpm/pnpm`,
    `${home}/.npm-global/bin/pnpm`,
    `${home}/.nvm/current/bin/pnpm`,
    '/usr/local/bin/pnpm',
    '/usr/bin/pnpm',
    'pnpm',
  ];
  for (const p of direct) {
    const q = shellQuote(p);
    if (pnpmWorks(q, cwd)) return persist(q);
  }

  // 3. Login shell PATH (covers nvm/fnm/corepack shims in the user's profile).
  for (const probe of [`bash -lc 'command -v pnpm'`, `bash -lic 'command -v pnpm' 2>/dev/null`]) {
    try {
      const found = execSync(probe, { cwd, encoding: 'utf-8', timeout: 20000 }).trim().split('\n').pop()?.trim();
      if (found && pnpmWorks(shellQuote(found), cwd)) return persist(shellQuote(found));
    } catch { /* next */ }
  }

  // 4. Corepack (ships with Node).
  if (pnpmWorks('corepack pnpm', cwd)) return persist('corepack pnpm');

  return 'pnpm';
}

/** Resolve a working `git` invocation (config gitPath → common paths → PATH). */
function resolveGitCmd(cwd: string, nodeDB?: NodeDB): string {
  const persist = (c: string): string => { try { nodeDB?.setConfig('gitPath', c); } catch { /* ignore */ } return c; };
  const stored = nodeDB?.getConfig('gitPath');
  if (stored) { const cmd = shellQuote(stored); if (pnpmWorks(cmd, cwd)) return cmd; }
  const home = process.env.HOME || process.env.USERPROFILE || '/home/pi';
  for (const p of ['git', '/usr/bin/git', '/usr/local/bin/git', `${home}/bin/git`]) {
    const q = shellQuote(p);
    if (pnpmWorks(q, cwd)) return persist(q);
  }
  try {
    const found = execSync(`bash -lc 'command -v git'`, { cwd, encoding: 'utf-8', timeout: 20000 }).trim().split('\n').pop()?.trim();
    if (found && pnpmWorks(shellQuote(found), cwd)) return persist(shellQuote(found));
  } catch { /* next */ }
  return 'git';
}

/** Resolve the node binary path (config nodePath → the running interpreter). */
function resolveNodePath(nodeDB?: NodeDB): string {
  const stored = nodeDB?.getConfig('nodePath');
  if (stored && existsSync(stored)) return stored;
  // The interpreter running this very process is the most reliable answer.
  if (process.execPath && existsSync(process.execPath)) {
    try { nodeDB?.setConfig('nodePath', process.execPath); } catch { /* ignore */ }
    return process.execPath;
  }
  return 'node';
}

/** Where the auto-config snapshot is written (next to the relay DB). */
function updateConfigPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '/home/pi';
  return join(home, '.muster-relay', 'update-config.json');
}

/**
 * `/update autoconf` — probe + persist every tool/location the self-update
 * needs (git, node, pnpm), write a snapshot file the admin can read/edit, and
 * store the resolved paths in node config (gitPath/nodePath/pnpmPath) so the
 * next `/update` just works. Admin overrides via `/config set <key> <path>`.
 */
export function autoconfigure(nodeDB: NodeDB): { success: boolean; log: string[] } {
  const log: string[] = [];
  const gitRoot = findGitRoot() || process.cwd();
  log.push('🔧 Auto-configuring update toolchain…');
  log.push(`Git root: ${gitRoot}`);
  log.push('');

  // Resolve node first so the pnpm probe can look next to the node binary.
  const node = resolveNodePath(nodeDB);
  const git = resolveGitCmd(gitRoot, nodeDB);
  const pnpm = resolvePnpmCmd(gitRoot, nodeDB);
  const branch = getGitBranch();

  const gitOk = pnpmWorks(git, gitRoot);
  const pnpmOk = pnpmWorks(pnpm, gitRoot);
  const nodeOk = node === 'node' ? false : existsSync(node.replace(/^"|"$/g, ''));

  const cfg = {
    detectedAt: new Date().toISOString(),
    gitRoot, branch, git, node, pnpm,
    steps: [
      `${git} pull origin ${branch}`,
      `${pnpm} install --frozen-lockfile`,
      `${pnpm} --filter './packages/**' build`,
      `${pnpm} --filter @muster/relay build`,
    ],
  };

  const path = updateConfigPath();
  try {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(cfg, null, 2));
  } catch {
    log.push(`⚠️ Could not write ${path}`);
  }

  log.push(`git:   ${git}   ${gitOk ? '✓' : '✗ NOT WORKING'}`);
  log.push(`pnpm:  ${pnpm}   ${pnpmOk ? '✓' : '✗ NOT WORKING'}`);
  log.push(`node:  ${node}   ${nodeOk ? '✓' : '(using PATH)'}`);
  log.push('');
  log.push(`Saved → ${path}`);
  log.push('Stored in config: gitPath, pnpmPath, nodePath');
  log.push('');
  log.push('Wrong path? Override it:');
  log.push('  /config set pnpmPath <full-path>');
  log.push('  /config set gitPath <full-path>');
  log.push('  /config set nodePath <full-path>');
  if (!pnpmOk) { log.push(''); log.push('⚠️ pnpm not found. Run `which pnpm` on the server, then'); log.push('   /config set pnpmPath <that path>'); }

  return { success: gitOk && pnpmOk, log };
}

/** Read the monotonic build number from version.json (best-effort). The
 *  desktop UI is the authoritative display; this is for the relay boot log. */
export function getBuildNumber(): number | string {
  try {
    const candidates = [
      join(process.cwd(), 'version.json'),
      join(process.cwd(), '..', 'version.json'),
      join(process.cwd(), '..', '..', 'version.json'),
      join(__dirname, '..', 'version.json'),
      join(__dirname, '..', '..', 'version.json'),
      join(__dirname, '..', '..', '..', 'version.json'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        const v = JSON.parse(readFileSync(p, 'utf-8'));
        if (typeof v.build === 'number') return v.build;
      }
    }
  } catch { /* ignore */ }
  return '?';
}

/** Compare semver: returns 1 if a > b, -1 if a < b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

/** Find the git root directory. */
function findGitRoot(): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return null;
  }
}

/** Get current git branch. */
export function getGitBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return 'unknown';
  }
}

/** Get current git commit hash (short). */
export function getGitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    return 'unknown';
  }
}

/** Check if there are updates available (git fetch + compare). */
export function checkForUpdates(): { available: boolean; behind: number; branch: string; error?: string } {
  try {
    const gitRoot = findGitRoot();
    if (!gitRoot) return { available: false, behind: 0, branch: 'unknown', error: 'Not a git repository' };

    const branch = getGitBranch();

    // Fetch latest from remote
    execSync('git fetch origin', { cwd: gitRoot, encoding: 'utf-8', timeout: 30000, stdio: 'pipe' });

    // Check how many commits behind
    const behindStr = execSync(`git rev-list HEAD..origin/${branch} --count`, {
      cwd: gitRoot, encoding: 'utf-8', timeout: 5000, stdio: 'pipe',
    }).trim();

    const behind = parseInt(behindStr) || 0;

    return { available: behind > 0, behind, branch };
  } catch (err: any) {
    return { available: false, behind: 0, branch: getGitBranch(), error: err.message?.slice(0, 100) || 'Unknown error' };
  }
}

/** Execute the full update process. Returns a log of what happened. */
export function executeUpdate(nodeDB: NodeDB): Promise<{ success: boolean; log: string[] }> {
  return new Promise((resolve) => {
    const log: string[] = [];
    const gitRoot = findGitRoot();

    if (!gitRoot) {
      resolve({ success: false, log: ['ERROR: Not a git repository. Cannot update.'] });
      return;
    }

    const branch = getGitBranch();
    log.push(`Git root: ${gitRoot}`);
    log.push(`Branch: ${branch}`);
    log.push('');

    // Resolve a working pnpm invocation. The relay often runs under a
    // service whose PATH lacks a user-installed pnpm (`/bin/sh: pnpm: not
    // found`). corepack ships with Node and lives next to the node binary
    // that's already on PATH, so `corepack pnpm` is the reliable fallback.
    const pnpm = resolvePnpmCmd(gitRoot, nodeDB);
    const git = resolveGitCmd(gitRoot, nodeDB);
    log.push(`Using git: ${git}`);
    log.push(`Using pnpm: ${pnpm}`);

    const steps = [
      { name: 'git pull', cmd: `${git} pull origin ${branch}` },
      { name: 'pnpm install', cmd: `${pnpm} install --frozen-lockfile` },
      { name: 'build packages', cmd: `${pnpm} --filter './packages/**' build` },
      { name: 'build relay', cmd: `${pnpm} --filter @muster/relay build` },
    ];

    let stepIdx = 0;

    const runNext = () => {
      if (stepIdx >= steps.length) {
        // All steps complete — save update log
        const versionAfter = getCurrentVersion();
        const commitAfter = getGitCommit();
        nodeDB.setConfig('lastUpdate', new Date().toISOString());
        nodeDB.setConfig('lastUpdateCommit', commitAfter);
        log.push('');
        log.push(`✅ Update complete. Version: ${versionAfter} (${commitAfter})`);
        log.push('Node will restart in 3 seconds...');
        resolve({ success: true, log });
        return;
      }

      const step = steps[stepIdx]!;
      log.push(`▶ ${step.name}...`);

      try {
        const output = execSync(step.cmd, {
          cwd: gitRoot,
          encoding: 'utf-8',
          timeout: 120000, // 2 min per step
          stdio: 'pipe',
        });

        // Only include last few lines of output
        const lines = output.trim().split('\n');
        const summary = lines.length > 3 ? lines.slice(-3) : lines;
        for (const l of summary) {
          if (l.trim()) log.push(`  ${l.trim()}`);
        }
        log.push(`  ✓ ${step.name} OK`);

        stepIdx++;
        runNext();
      } catch (err: any) {
        const errMsg = err.stderr?.trim()?.split('\n').slice(-3).join('\n') || err.message || 'Unknown error';
        log.push(`  ✗ ${step.name} FAILED`);
        log.push(`  ${errMsg.slice(0, 200)}`);
        if (/pnpm: not found|command not found|not recognized/i.test(errMsg)) {
          log.push('');
          log.push('💡 pnpm was not found on this server. Find it with `which pnpm`');
          log.push('   then tell me: /config set pnpmPath <full-path>');
          log.push('   (e.g. /config set pnpmPath /home/pi/.local/share/pnpm/pnpm)');
        }
        resolve({ success: false, log });
      }
    };

    runNext();
  });
}
