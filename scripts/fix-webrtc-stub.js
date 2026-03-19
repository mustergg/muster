#!/usr/bin/env node
/**
 * postinstall script — creates WebRTC stub for ARM/platforms without native support.
 * Runs automatically after pnpm install.
 */
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { readdirSync } from 'fs';

const pnpmDir = join(process.cwd(), 'node_modules', '.pnpm');
if (!existsSync(pnpmDir)) process.exit(0);

const stub = `export const webRTC = () => ({ [Symbol.toStringTag]: 'WebRTC-stub' })\nexport const webRTCDirect = () => ({ [Symbol.toStringTag]: 'WebRTCDirect-stub' })\nexport default { webRTC, webRTCDirect }\n`;
const pkgJson = `{"name":"@libp2p/webrtc","version":"5.2.24","type":"module","exports":{".":"./dist/src/index.js"}}\n`;

let patched = 0;
for (const dir of readdirSync(pnpmDir)) {
  const webrtcPath = join(pnpmDir, dir, 'node_modules', '@libp2p', 'webrtc');
  if (existsSync(webrtcPath)) {
    const srcDir = join(webrtcPath, 'dist', 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'index.js'), stub);
    writeFileSync(join(webrtcPath, 'package.json'), pkgJson);
    patched++;
  }
}

if (patched > 0) console.log(`[muster] Patched ${patched} @libp2p/webrtc instance(s) with ARM-compatible stub.`);