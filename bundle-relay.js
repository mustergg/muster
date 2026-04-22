/**
 * Bundle Relay — creates a standalone relay bundle for distribution.
 *
 * Uses esbuild to inline all pure JS dependencies (ws, nodemailer, etc.)
 * into a single file. Native modules (better-sqlite3) are marked external
 * and their bindings are copied alongside.
 *
 * Usage: node bundle-relay.js
 * Output: apps/relay/bundle/
 *   ├── relay.js          (single-file bundle)
 *   └── node_modules/
 *       └── better-sqlite3/  (native addon only)
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const tar = require('tar-fs');

const RELAY_ENTRY = path.resolve(__dirname, 'apps/relay/dist/index.js');
const OUT_DIR = path.resolve(__dirname, 'apps/relay/bundle');
const OUT_FILE = path.join(OUT_DIR, 'relay.js');

// Native modules that can't be bundled (C++ addons)
const NATIVE_EXTERNALS = ['better-sqlite3', 'nodemailer'];

// ABI versions we ship prebuilds for. Maps node major -> process.versions.modules.
// Allows the bundled relay to run on any Node in this set without rebuild.
const BETTER_SQLITE3_VERSION = '12.9.0';
const PREBUILD_ABIS = [
  { node: 20, abi: 115 },
  { node: 22, abi: 127 },
  { node: 23, abi: 131 },
  { node: 24, abi: 137 },
];

async function bundle() {
  console.log('[bundle] Bundling relay...');

  // Clean output dir
  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true });
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Bundle with esbuild
  await esbuild.build({
    entryPoints: [RELAY_ENTRY],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: OUT_FILE,
    format: 'cjs',
    external: NATIVE_EXTERNALS,
    minify: false, // Keep readable for debugging
    sourcemap: false,
    // Handle __dirname/__filename for bundled code
    define: {
      'import.meta.url': 'undefined',
    },
    banner: {
      js: '// Muster Relay — Standalone Bundle\n',
    },
  });

  console.log(`[bundle] Bundle created: ${OUT_FILE}`);

  // Copy native modules
  for (const mod of NATIVE_EXTERNALS) {
    copyNativeModule(mod);
  }

  // Ship better-sqlite3 prebuilds for every supported Node ABI so the
  // relay can run on Node 20/22/24 without a local native rebuild.
  await multiAbiBetterSqlite3();

  // Verify bundle
  const stats = fs.statSync(OUT_FILE);
  console.log(`[bundle] Size: ${(stats.size / 1024).toFixed(0)} KB`);
  console.log('[bundle] Done!');
}

async function multiAbiBetterSqlite3() {
  const platform = process.platform;
  const arch = process.arch;
  const moduleDir = path.join(OUT_DIR, 'node_modules', 'better-sqlite3');
  const releaseDir = path.join(moduleDir, 'build', 'Release');

  if (!fs.existsSync(releaseDir)) {
    console.warn('[bundle] better-sqlite3 build/Release missing; skipping multi-ABI');
    return;
  }

  console.log(`[bundle] Fetching better-sqlite3 prebuilds for ${platform}-${arch}`);

  for (const { node, abi } of PREBUILD_ABIS) {
    const name = `better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v${abi}-${platform}-${arch}.tar.gz`;
    const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${BETTER_SQLITE3_VERSION}/${name}`;
    const targetDir = path.join(releaseDir, `v${abi}`);
    fs.mkdirSync(targetDir, { recursive: true });
    try {
      await downloadAndExtractNode(url, targetDir);
      console.log(`[bundle]   ok: node ${node} (abi ${abi})`);
    } catch (err) {
      console.warn(`[bundle]   skip node ${node} (abi ${abi}): ${err.message}`);
    }
  }

  // Replace the single-ABI entry point with a selector shim.
  const defaultNode = path.join(releaseDir, 'better_sqlite3.node');
  if (fs.existsSync(defaultNode)) fs.rmSync(defaultNode);

  patchBetterSqlite3Loader(moduleDir);
}

function patchBetterSqlite3Loader(moduleDir) {
  const dbFile = path.join(moduleDir, 'lib', 'database.js');
  if (!fs.existsSync(dbFile)) {
    console.warn('[bundle] better-sqlite3 lib/database.js missing; cannot patch loader');
    return;
  }
  const src = fs.readFileSync(dbFile, 'utf8');
  const marker = "DEFAULT_ADDON = require('bindings')('better_sqlite3.node')";
  if (!src.includes(marker)) {
    console.warn('[bundle] better-sqlite3 loader marker not found; leaving untouched');
    return;
  }
  const replacement = "DEFAULT_ADDON = require('./abi-loader')()";
  const patched = src.replace(marker, replacement);
  fs.writeFileSync(dbFile, patched);

  const loader = `'use strict';
// Muster bundle: picks the prebuilt addon matching the running Node ABI.
const path = require('path');
const fs = require('fs');

module.exports = function loadBetterSqlite3() {
  const abi = process.versions.modules;
  const dir = path.resolve(__dirname, '..', 'build', 'Release', 'v' + abi);
  const file = path.join(dir, 'better_sqlite3.node');
  if (!fs.existsSync(file)) {
    throw new Error(
      'No better-sqlite3 prebuild for Node ABI ' + abi + ' (Node ' + process.version + '). ' +
      'Bundled ABIs: ' + (fs.existsSync(path.dirname(dir)) ? fs.readdirSync(path.dirname(dir)).filter(d => d.startsWith('v')).join(', ') : 'none') + '. ' +
      'Install a supported Node version or rebuild the bundle.'
    );
  }
  return require(file);
};
`;
  fs.writeFileSync(path.join(moduleDir, 'lib', 'abi-loader.js'), loader);
  console.log('[bundle] Patched better-sqlite3 to multi-ABI loader');
}

function downloadAndExtractNode(url, targetDir) {
  return new Promise((resolve, reject) => {
    const go = (u, redirects) => {
      if (redirects > 5) return reject(new Error('too many redirects'));
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return go(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        const gunzip = zlib.createGunzip();
        const extract = tar.extract(targetDir, {
          map: (header) => {
            // Flatten: only keep better_sqlite3.node at targetDir root
            const base = path.basename(header.name);
            header.name = base;
            return header;
          },
          ignore: (name, header) => {
            return path.basename(header ? header.name : name) !== 'better_sqlite3.node';
          },
        });
        res.pipe(gunzip).pipe(extract);
        extract.on('finish', () => {
          const expected = path.join(targetDir, 'better_sqlite3.node');
          fs.existsSync(expected) ? resolve() : reject(new Error('prebuild missing better_sqlite3.node'));
        });
        extract.on('error', reject);
        gunzip.on('error', reject);
      }).on('error', reject);
    };
    go(url, 0);
  });
}

function copyNativeModule(moduleName) {
  // Find the module in node_modules (pnpm hoists to monorepo root)
  const candidates = [
    path.resolve(__dirname, 'node_modules', moduleName),
    path.resolve(__dirname, '..', 'node_modules', moduleName),
    path.resolve(__dirname, 'apps', 'relay', 'node_modules', moduleName),
  ];

  let sourceDir = null;
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      sourceDir = dir;
      break;
    }
  }

  // Also check pnpm virtual store
  if (!sourceDir) {
    const pnpmStore = path.resolve(__dirname, 'node_modules', '.pnpm');
    if (fs.existsSync(pnpmStore)) {
      const dirs = fs.readdirSync(pnpmStore).filter(d => d.startsWith(moduleName + '@'));
      if (dirs.length > 0) {
        const candidate = path.join(pnpmStore, dirs[0], 'node_modules', moduleName);
        if (fs.existsSync(candidate)) sourceDir = candidate;
      }
    }
  }

  if (!sourceDir) {
    console.warn(`[bundle] WARNING: Could not find ${moduleName} — relay may not work without it`);
    return;
  }

  const targetDir = path.join(OUT_DIR, 'node_modules', moduleName);
  console.log(`[bundle] Copying ${moduleName} from ${sourceDir}`);

  // Copy the entire module (includes native .node bindings)
  copyDirSync(sourceDir, targetDir);
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Skip unnecessary files to reduce size
    if (entry.name === '.github' || entry.name === 'test' || entry.name === 'docs' ||
        entry.name === 'benchmark' || entry.name === '.eslintrc.js' ||
        entry.name === 'CHANGELOG.md' || entry.name === 'History.md') {
      continue;
    }

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

bundle().catch((err) => {
  console.error('[bundle] FAILED:', err);
  process.exit(1);
});
