/**
 * fetch-node-sidecar.js — downloads a portable Node.js runtime and places
 * it in apps/desktop/src-tauri/bin/ with the Tauri target-triple suffix.
 *
 * The desktop app spawns this binary to run the bundled relay (no host
 * Node install required). Pinned to Node 22 LTS for stable native module
 * ABI (better-sqlite3 prebuilds match).
 *
 * Skips download if the file already exists.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const tar = require('tar-fs');
const { execSync } = require('child_process');

const NODE_VERSION = '22.22.2';
const BIN_DIR = path.resolve(__dirname, '..', 'apps', 'desktop', 'src-tauri', 'bin');

const TARGETS = {
  'win32-x64':    { triple: 'x86_64-pc-windows-msvc',    archive: 'win-x64.zip',          binInArchive: 'node.exe',     ext: '.exe' },
  'darwin-x64':   { triple: 'x86_64-apple-darwin',       archive: 'darwin-x64.tar.gz',    binInArchive: 'bin/node',     ext: '' },
  'darwin-arm64': { triple: 'aarch64-apple-darwin',      archive: 'darwin-arm64.tar.gz',  binInArchive: 'bin/node',     ext: '' },
  'linux-x64':    { triple: 'x86_64-unknown-linux-gnu',  archive: 'linux-x64.tar.gz',     binInArchive: 'bin/node',     ext: '' },
  'linux-arm64':  { triple: 'aarch64-unknown-linux-gnu', archive: 'linux-arm64.tar.gz',   binInArchive: 'bin/node',     ext: '' },
};

async function main() {
  const key = `${process.platform}-${process.arch}`;
  const target = TARGETS[key];
  if (!target) {
    console.warn(`[node-sidecar] No mapping for ${key}; skipping`);
    return;
  }

  const outName = `node-${target.triple}${target.ext}`;
  const outPath = path.join(BIN_DIR, outName);
  if (fs.existsSync(outPath)) {
    console.log(`[node-sidecar] Already present: ${outName}`);
    return;
  }

  fs.mkdirSync(BIN_DIR, { recursive: true });

  const baseName = `node-v${NODE_VERSION}-${target.archive.replace(/\.(zip|tar\.gz)$/, '')}`;
  const archiveName = `node-v${NODE_VERSION}-${target.archive}`;
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${archiveName}`;
  const tmpArchive = path.join(BIN_DIR, archiveName);

  console.log(`[node-sidecar] Downloading ${url}`);
  await downloadToFile(url, tmpArchive);

  if (target.archive.endsWith('.zip')) {
    extractZipMember(tmpArchive, `${baseName}/${target.binInArchive}`, outPath);
  } else {
    await extractTarGzMember(tmpArchive, `${baseName}/${target.binInArchive}`, outPath);
  }
  fs.rmSync(tmpArchive);
  if (target.ext === '') fs.chmodSync(outPath, 0o755);

  console.log(`[node-sidecar] Installed: ${outName}`);
}

function downloadToFile(url, dest) {
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
        const ws = fs.createWriteStream(dest);
        res.pipe(ws);
        ws.on('finish', () => ws.close(resolve));
        ws.on('error', reject);
      }).on('error', reject);
    };
    go(url, 0);
  });
}

function extractZipMember(zipPath, member, outPath) {
  // Use system unzip (available on Windows via PowerShell 5+ Expand-Archive
  // or git-for-windows' bsdtar). Fall back to PowerShell as last resort.
  const tmpDir = path.join(BIN_DIR, '__tmp_unzip');
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    try {
      execSync(`tar -xf "${zipPath}" -C "${tmpDir}"`, { stdio: 'pipe' });
    } catch {
      execSync(`powershell -NoProfile -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${tmpDir}'"`, { stdio: 'pipe' });
    }
    const src = path.join(tmpDir, member);
    if (!fs.existsSync(src)) throw new Error(`Member missing in zip: ${member}`);
    fs.copyFileSync(src, outPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function extractTarGzMember(archivePath, member, outPath) {
  return new Promise((resolve, reject) => {
    let found = false;
    const stream = fs.createReadStream(archivePath).pipe(zlib.createGunzip());
    const extract = tar.extract(BIN_DIR + '/__tmp_tar', {
      ignore: (name, header) => (header ? header.name : name) !== member,
    });
    stream.pipe(extract);
    extract.on('finish', () => {
      const src = path.join(BIN_DIR, '__tmp_tar', member);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, outPath);
        fs.rmSync(path.join(BIN_DIR, '__tmp_tar'), { recursive: true, force: true });
        found = true;
        resolve();
      } else {
        reject(new Error(`Member missing in tar: ${member}`));
      }
    });
    extract.on('error', reject);
    stream.on('error', reject);
  });
}

main().catch((err) => {
  console.error('[node-sidecar] FAILED:', err.message);
  process.exit(1);
});
