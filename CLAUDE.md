# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Muster — a decentralized, P2P, Discord-style community platform. pnpm monorepo (`pnpm-workspace.yaml` covers `apps/*` and `packages/*`).

Releases are tagged `R<n>` (R1…R24). Features ship as "R milestones"; source/log comments reference them (`// R20: ...`, `feat: R23 — embedded client node`). When you make non-trivial changes, use the same convention.

## Common commands

All run from the repo root unless noted. Node ≥20, pnpm ≥8.

| Task | Command |
|---|---|
| Install | `pnpm install` (runs `scripts/fix-webrtc-stub.js` — see "WebRTC stub" below) |
| Build everything | `pnpm build` (packages first, then apps) |
| Build one workspace | `pnpm --filter @muster/<name> build` |
| Web dev (Vite, port 3000) | `pnpm dev:web` |
| Relay dev (tsx, no compile) | `pnpm --filter @muster/relay dev` |
| Relay prod | `pnpm --filter @muster/relay build && pnpm --filter @muster/relay start` |
| Tests (crypto only — others have none) | `pnpm test` or `pnpm --filter @muster/crypto test` |
| Bundle relay for desktop distribution | `pnpm --filter @muster/relay build && node bundle-relay.js` |
| Desktop dev (Tauri, spawns Vite) | `pnpm --filter @muster/desktop dev` |
| Desktop build (Win/macOS/Linux/Android) | `pnpm --filter @muster/desktop build[:windows|:macos|:linux|:android]` |

There is no lint/format/typecheck script at the repo level. The web app declares `lint` (`eslint src --ext .ts,.tsx`) but no eslint config is committed. `tsc` is the de-facto type check (run `pnpm --filter <pkg> build`).

## High-level architecture

### Apps

- **`apps/web`** — React 18 + Vite SPA. State via Zustand (one store per domain in `src/stores/`). UI is split between `src/pages/` (top-level routes / modals) and `src/components/` (sidebars, panels). Talks to a relay over WebSocket via `@muster/transport`.
- **`apps/relay`** — Node.js WebSocket server (`ws`) with SQLite (`better-sqlite3`) persistence. Single entry point at `src/index.ts`. Every feature has a paired `<feature>DB.ts` (SQLite tables + queries) and `<feature>Handler.ts` (message dispatch). All databases share one connection (`messageDB.getDatabase()`); tables are added via `init…Tables(db)` calls in the DB classes' constructors. DB lives at `~/.muster-relay/relay.db` (WAL mode).
- **`apps/desktop`** — Tauri v2 shell (Rust in `src-tauri/`). On startup the frontend (web build) is loaded, and `useClientNodeStore` can spawn the bundled relay as a child process via `@tauri-apps/plugin-shell`. The relay binary is brought in as a Tauri *resource* — see `tauri.conf.json` `bundle.resources`: `"../../relay/bundle/": "relay/"`. Window-close hides to system tray instead of quitting; `muster://` deep links are forwarded to the frontend via the `deep-link` event.

### Packages

- **`@muster/protocol`** — Wire message types. One file per feature (`dm-messages.ts`, `community-messages.ts`, `voice-messages.ts`, …) re-exported from `index.ts`. The base shape is `{ type, payload, timestamp, signature?, senderPublicKey? }`.
- **`@muster/crypto`** — Two **separate entry points**:
  - `@muster/crypto` — Ed25519 signing/verification, key derivation (`deriveKeyPair(username, password)` via PBKDF2-SHA512 / 210k iters), AES-GCM keystore.
  - `@muster/crypto/e2e` — X25519 / ECDH / AES-256-GCM for DM E2E.
  - **Why split**: the relay must not pull in `@noble/curves` (ARM compatibility / smaller bundle). Relay imports only the root entry; the web app imports both. Don't merge them.
- **`@muster/transport`** — `Transport` interface + `WebSocketTransport` (auto-reconnect with exponential backoff + jitter). Designed so a future BLE transport can drop in without consumer changes.
- **`@muster/db`** — Browser-side IndexedDB via Dexie (`BrowserDB`). Used only by `apps/web` for offline message cache.
- **`@muster/i18n`** — i18next bootstrap. `en` / `pt` translations are **inlined directly into `src/index.ts`** (locale JSON files in `src/locales/` are not the source of truth for the runtime — edit `index.ts`).

### Message flow

1. Client opens WS → relay sends `AUTH_CHALLENGE` (random 32 bytes).
2. Client signs the challenge with Ed25519 private key, sends `AUTH_RESPONSE { publicKey, signature, username, authMode: 'login'|'signup' }`.
3. Relay verifies signature, enforces username uniqueness per public key, replies `AUTH_RESULT` and `ACCOUNT_INFO`.
4. All subsequent messages are routed by `type` in `apps/relay/src/index.ts:handleMessage`. Type sets (`COMMUNITY_TYPES`, `DM_TYPES`, …) gate which handler module receives them.

**Adding a new message type:**
1. Add the type to `packages/protocol/src/<feature>-messages.ts` (export from `index.ts`).
2. If new feature: create `apps/relay/src/<feature>DB.ts` (extends shared SQLite db) and `<feature>Handler.ts`.
3. Register in `apps/relay/src/index.ts`: add to a type set, instantiate the DB at top, add a dispatch line in `handleMessage`.
4. On the client: add a Zustand store (or extend an existing one) under `apps/web/src/stores/`; subscribe via `useNetworkStore.onMessage(handler)` and send via `transport.send(...)`.

### Three-tier node architecture (R21)

`apps/relay/src/nodeTier.ts:TierManager` owns this. Tiers:
- **`main`** — unlimited disk/bandwidth, permanent retention, auto-hosts every community on the node.
- **`client`** — user-run from desktop app. Permanent retention for *hosted* communities/squads, 30-day buffer for cached content. Default 5 GB / 1 GB-per-day caps.
- **`temp`** — browser/mobile. 30-day retention for everything, ~10% passive contribution.

Tier comes from `MUSTER_NODE_TIER` env var or stored DB config. The purge scheduler (every 6 h) deletes non-hosted content older than `defaultRetentionDays`. Hosted-status decisions go through `tierManager.isHosted(communityId)`.

### Multi-node mesh (R15+)

`apps/relay/src/peerManager.ts` runs **both** as a WS client (outbound to known peers) and consumes inbound `NODE_HANDSHAKE` messages. Three protocols on top of the relay WS port:
- **PEX** — every 5 min, peers gossip their known-peer lists (`PEX_SHARE`).
- **Sync** — `NODE_SYNC_REQUEST` / `NODE_SYNC_RESPONSE` for catching up community history (last 60 d).
- **Forwarding** — when a client publishes, the relay forwards via `peerManager.forwardMessage(communityId, …)` to peers that host the same community.

`apps/relay/src/wsRelay.ts` adds a NAT-bypass proxy mode (R24): a Client Node behind NAT keeps an outbound socket to a Main Node, which routes browser-client requests through it (E2E-encrypted blind proxy).

### Client-side node discovery (R20)

`apps/web/src/stores/nodeDiscovery.ts` ranks nodes by: last-connected → stability score (`uptimePercent × log2(activeDays + 1)`) → connect count → seeds last. `networkStore.connect()` walks the list with a 2 s gap on failure (`MAX_FALLBACK_ATTEMPTS = 10`). Persisted to `localStorage` under `muster-known-nodes`. Seed nodes are hardcoded in `nodeDiscovery.ts` and `seed-nodes.json` (the latter is a reference doc, not auto-loaded).

## Build / runtime quirks

- **WebRTC stub** — `pnpm install` triggers `scripts/fix-webrtc-stub.js`, which patches every `@libp2p/webrtc` instance under `node_modules/.pnpm/` with an empty stub for ARM compatibility. The root `package.json` also overrides `@ipshipyard/node-datachannel` and `node-datachannel` to `empty-module`. Don't remove these — the relay refuses to start on RPi without them.
- **Bundling the relay** (`bundle-relay.js`) — esbuild inlines pure-JS deps (`ws`, `nodemailer`, …) into one file at `apps/relay/bundle/relay.js`, then copies native addons (`better-sqlite3`, `nodemailer`) into `apps/relay/bundle/node_modules/`. The desktop app's Tauri config maps this whole directory into `relay/` inside the installed app. `clientNodeStore.ts:resolveRelayPath` resolves it via `@tauri-apps/api/path resolveResource('relay/relay.js')` and spawns it with `NODE_PATH` set to the sibling `node_modules/`.
- **Noble curves dedup** — `apps/web/vite.config.ts` aliases `@noble/curves/ed25519(.js)` to the root `node_modules/@noble/curves/ed25519.js` and dedupes `@noble/curves`, `@noble/hashes`, `@noble/ciphers`. Multiple copies break the bigint key-conversion in `packages/crypto/src/e2e.ts`. Don't change `@noble/curves` from the pinned `1.9.7` in `packages/crypto/package.json` without revisiting this.
- **Web polyfills** — `vite-plugin-node-polyfills` provides `buffer`/`crypto`/`stream`/`util`. `Buffer` is set on `window` in `main.tsx`. Some crypto helpers assume `Buffer` is present.
- **TS settings** — `tsconfig.base.json` is strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`). The web app's `tsconfig.json` deliberately *relaxes* both. Packages keep the strict baseline.
- **ES modules** — packages use `"type": "module"` and `Node16` resolution; intra-package imports must use the `.js` extension (`import { foo } from './bar.js'`) even in `.ts` source.

## Relay environment variables

Set in shell or systemd unit; see `apps/relay/env.example.ts`.

| Var | Default | Notes |
|---|---|---|
| `MUSTER_WS_PORT` | `4002` | |
| `MUSTER_NODE_URL` | `ws://0.0.0.0:<port>` | Advertised to peers |
| `MUSTER_RETENTION_DAYS` | `30` | Used by the legacy global cleanup; tier purge uses `tierConfig.defaultRetentionDays` instead |
| `MUSTER_NODE_TIER` | (DB stored, fallback `main`) | `main` / `client` / `temp` |
| `MUSTER_MAX_DISK_MB`, `MUSTER_MAX_BW_MB` | tier defaults | Soft limits, set by client-node spawner |
| `SMTP_HOST` / `PORT` / `USER` / `PASS` / `FROM` / `SECURE` | unset → codes printed to console | Email verification for the `verified` user tier |

## Files to know

- `apps/relay/src/index.ts` — single message dispatch table, the entry to almost every relay feature.
- `apps/web/src/stores/networkStore.ts` — the WS client + auth handshake; every other web store hangs off `useNetworkStore.onMessage`.
- `apps/web/src/stores/nodeDiscovery.ts` — node selection / fallback policy.
- `bundle-relay.js` + `apps/desktop/src-tauri/tauri.conf.json` — desktop relay packaging.
- `packages/crypto/src/e2e.ts` — manual Ed25519↔X25519 conversion (BigInt math); fragile, don't "simplify" without tests.
