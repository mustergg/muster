# Muster

> A decentralised, end-to-end encrypted, community-first communication platform.

Muster gives you communities, channels, voice, DMs, and file sharing — without handing your identity, your data, or your ability to communicate to a single company. Everything lives on a **swarm of nodes** run by the people using the network. No central tracker, no mandatory cloud, no vendor lock-in.

**Status:** active development, pre-beta. Looking for contributors, testers, and early node operators.

---

## What makes it different

- **Decentralised by design.** A BitTorrent-style swarm distributes content across a mesh of nodes. If every main node went offline tomorrow, the network would keep working.
- **End-to-end encrypted at rest and in motion.** Public channels, private channels, DMs — all encrypted. Membership is the key.
- **Three-tier node model.** Run a dedicated server, let your desktop help out in the background, or just keep a browser tab open — every tier contributes to the network without hurting your bandwidth.
- **Open source, Ed25519 identities, verifiable history.** No magic, no backdoors, no "trust us".

Read the full architecture: [`docs/architecture/ARCHITECTURE.md`](./docs/architecture/ARCHITECTURE.md).

---

## Quick start

### Requirements

- Node.js ≥ 20
- pnpm ≥ 8
- Linux / macOS / Windows (desktop builds) or any modern browser

### Run the web app against a local relay

```bash
pnpm install

# Start a local relay
pnpm --filter @muster/relay dev

# In another terminal, start the web app (port 3000)
pnpm dev:web
```

Open <http://localhost:3000>, create an account, connect to `ws://localhost:4002`, and you're in.

### Run the desktop app

```bash
pnpm --filter @muster/desktop dev
```

The desktop app bundles its own relay and Node runtime — no system Node install needed to run the compiled app.

### Run your own dedicated node

A Raspberry Pi, a cheap VPS, or a home server all work. Clone the repo, build the relay, and run it as a systemd service. Deployment guide *coming soon*.

---

## Project structure

```
muster/
├── apps/
│   ├── web/            # React + Vite SPA
│   ├── relay/          # Node.js + SQLite WebSocket relay
│   └── desktop/        # Tauri v2 desktop shell (Windows/macOS/Linux/Android)
├── packages/
│   ├── protocol/       # Wire message types
│   ├── crypto/         # Ed25519 signing + X25519/AES E2E
│   ├── transport/      # Pluggable transports (WS today, BLE later)
│   ├── db/             # Browser IndexedDB cache
│   └── i18n/           # Translations (EN, PT)
├── docs/
│   ├── architecture/   # Design docs and decision records
│   └── roadmap/        # Beta roadmap
└── scripts/            # Build helpers
```

Each app and package has its own `README` (in progress).

---

## Architecture in one paragraph

Every message is an **envelope** (signed metadata, under a few KB) plus an optional **blob** (the actual content — photos, voice, video, long text). Blobs are split into 256 KB pieces addressed by SHA-256 hashes and form Merkle trees. Envelopes are grouped into **chunks** of 1000, sealed, signed, and chained like a Git log per channel. Nodes advertise which chunks and pieces they hold; others fetch what they need via a BitSwap-inspired want/have exchange. Communities have owner-signed manifests that anchor their admin rosters. Admin actions form a causally ordered log (each action references the one before). DMs are sealed-sender, routed via salted inbox hashes. A Kademlia DHT handles peer discovery. A proof-of-storage challenge keeps peers honest.

For the full explanation, see [`ARCHITECTURE.md`](./docs/architecture/ARCHITECTURE.md).

---

## Contributing

Muster is an open-source project and welcomes contributors.

### Good first issues

- Translating `packages/i18n/src/index.ts` to a new locale.
- Running a dedicated node on a Raspberry Pi and reporting issues.
- Writing platform-specific packaging documentation.

### Bigger contributions

Open a discussion before starting a subsystem-level contribution so we can align on approach. The maintainers publish phase-by-phase plans in the issue tracker as work becomes available.

### Rules

- All technical comments and code in **English**.
- Releases are tagged `R<n>` (R1, R2, …). When you land a non-trivial change, reference the milestone in commits and comments (`// R25: ...`).
- Use `pnpm` (not `npm`). Intra-package TypeScript imports must use the `.js` suffix.
- Strict TypeScript by default. `apps/web` deliberately relaxes a couple of flags; everything else is strict.
- No telemetry. No analytics. If you want to log something, log it locally.

---

## Security

End-to-end encryption is a core promise, not a feature. If you find a security issue, please email `security@muster.gg` rather than opening a public issue. PGP key available on the same address.

---

## License

MIT. See [`LICENSE`](./LICENSE) *(coming soon — pending final review)*.

---

## Links

- **Website:** <https://muster.gg> *(coming soon)*
- **Architecture:** [`docs/architecture/ARCHITECTURE.md`](./docs/architecture/ARCHITECTURE.md)

---

*Muster is built by a small team that believes communities shouldn't be hostage to platforms. Join us.*
