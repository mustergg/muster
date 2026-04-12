/**
 * Node Updater — R17
 *
 * Handles self-update via git pull + pnpm rebuild + restart.
 * Tracks version from package.json, compares with peer versions.
 */

import { execSync, exec } from 'child_process';
import { readFileSync, existsSync } from 'fs';
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

    const steps = [
      { name: 'git pull', cmd: `git pull origin ${branch}` },
      { name: 'pnpm install', cmd: 'pnpm install --frozen-lockfile' },
      { name: 'build packages', cmd: "pnpm --filter './packages/**' build" },
      { name: 'build relay', cmd: 'pnpm --filter @muster/relay build' },
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
        resolve({ success: false, log });
      }
    };

    runNext();
  });
}
