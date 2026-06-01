#!/usr/bin/env node
/**
 * bump-build.js — single source of truth for app version + build number.
 *
 * version.json at the repo root holds:
 *   { version: "MAJOR.MINOR.PATCH", build: <monotonic int>, stage: "alpha"|"beta"|"rc"|"stable" }
 *
 * Usage:
 *   node scripts/bump-build.js                 # +1 build, re-sync version into all manifests
 *   node scripts/bump-build.js --version 0.1.0 # set version (keeps build counter), re-sync
 *   node scripts/bump-build.js --stage beta    # set stage, re-sync
 *   node scripts/bump-build.js --sync          # just re-sync, no build bump
 *
 * "build" is monotonic and never resets — it uniquely identifies a build for
 * bug reports regardless of the human-readable version. The semver "version"
 * follows: 0.0.x alpha → 0.1.x beta → 0.2.x … → 1.0.0 public.
 *
 * The script writes `version` into every package.json + tauri.conf.json so
 * getCurrentVersion() and the Tauri bundle stay in lock-step.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const versionFile = path.join(root, 'version.json');

const args = process.argv.slice(2);
function argVal(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

const v = JSON.parse(fs.readFileSync(versionFile, 'utf-8'));

const setVersion = argVal('--version');
const setStage = argVal('--stage');
const syncOnly = args.includes('--sync');

if (setVersion) v.version = setVersion;
if (setStage) v.stage = setStage;
if (!syncOnly && !setVersion && !setStage) v.build = (v.build || 0) + 1;
else if (!syncOnly) v.build = (v.build || 0) + 1; // any change is a new build

fs.writeFileSync(versionFile, JSON.stringify(v, null, 2) + '\n');

// Targets that carry a "version" field.
const targets = [
  'package.json',
  'apps/desktop/package.json',
  'apps/web/package.json',
  'apps/relay/package.json',
];
for (const rel of targets) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) continue;
  const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
  pkg.version = v.version;
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
}

// Tauri config.
const tauri = path.join(root, 'apps/desktop/src-tauri/tauri.conf.json');
if (fs.existsSync(tauri)) {
  const conf = JSON.parse(fs.readFileSync(tauri, 'utf-8'));
  conf.version = v.version;
  fs.writeFileSync(tauri, JSON.stringify(conf, null, 2) + '\n');
}

console.log(`[version] ${v.version} build ${v.build} (${v.stage}) — synced to manifests`);
