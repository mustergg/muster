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

const RELAY_ENTRY = path.resolve(__dirname, 'apps/relay/dist/index.js');
const OUT_DIR = path.resolve(__dirname, 'apps/relay/bundle');
const OUT_FILE = path.join(OUT_DIR, 'relay.js');

// Native modules that can't be bundled (C++ addons)
const NATIVE_EXTERNALS = ['better-sqlite3', 'nodemailer'];

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

  // Verify bundle
  const stats = fs.statSync(OUT_FILE);
  console.log(`[bundle] Size: ${(stats.size / 1024).toFixed(0)} KB`);
  console.log('[bundle] Done!');
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
