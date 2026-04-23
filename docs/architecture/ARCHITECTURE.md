# Muster — Architecture

A decentralised, end-to-end encrypted, community-first communication platform. Discord-style UX, BitTorrent-style distribution, no central authority.

This document is written for three audiences:

- **Users** who want to understand what "decentralised" actually means here.
- **Investors** who want to know what's defensible about the design.
- **Developers** who want to contribute and need the mental model before touching code.

---

## What Muster is

Muster gives you the feeling of Discord — communities, channels, DMs, voice chat, file sharing — without any of the parts that make Discord uncomfortable: a central company that reads your data, owns your identity, and can turn the whole thing off.

Everything you see in Muster — every community, every message, every file — lives on a **swarm of nodes**, not a cloud. Some nodes belong to the people running the communities. Some belong to volunteers who donate a slice of their disk. Some are just browser tabs that happen to be open right now.

If every main node in the network were to go offline tomorrow, Muster would keep working.

---

## The three-tier node model

Not every device is equal. A tower PC running 24/7 is fundamentally different from a phone on LTE. Muster recognises three classes of node, each with its own rules.

### Dedicated nodes

Run by organisations, businesses, or enthusiastic individuals on real server hardware (VPS, homelab, a Raspberry Pi at the back of a closet). These are the **90%-uptime** backbone. They host one or more communities / squads permanently — the hosted content never expires on them.

They also donate **10% of their allocated disk** to network cache: anonymous, encrypted chunks from communities they do not belong to and cannot read, just to help the swarm.

Example: you rent a 10 GB VPS. 9 GB is the home of the three communities you run; 1 GB is your contribution to the wider network.

### Client nodes

A regular user's desktop running in the background. Same responsibilities as a dedicated node — host your stuff permanently, donate 10% cache — but with one difference: **intermittent uptime**. You turn your PC off at night. You go on holiday for a week. You drag the laptop between Wi-Fi networks.

While you're offline, the swarm keeps serving your communities for anyone who needs them (up to 30 days of rolling cache). When you come back online, your node re-syncs whatever it missed and resumes its role.

Minimum disk commitment: 1 GB (90% yours, 10% network). Bandwidth is capped so Muster never outruns your actual work — if you're mid-game or on a video call, Muster automatically backs off.

### Temp nodes

The lightest tier. Every desktop install runs a temp node in the background automatically. Mobile opts in.

Temp nodes don't pre-allocate disk. They start with a small cache (around 50 MB) that grows with use as the app caches content you view. In parallel, **10% of whatever you've used** is donated to the network — so a user with a heavy 2 GB cache donates about 200 MB of encrypted seeding. Bandwidth is capped the same way.

### Web clients

The browser is a thin client. Almost no cache. Content streams in on demand from the swarm. Perfect for "just checking in" from a library PC or a phone browser.

---

## How the network moves data

### Messages as envelopes, content as blobs

Every message in Muster has two parts.

**The envelope** is small: who sent it, when, what channel, a signature, and either the inline text (if the message is under 4 KB) or a *reference* to a blob. Envelopes are fast to send, fast to verify, cheap to store.

**The blob** is the actual content — a photo, a voice note, a video, a large file, a long text. Blobs are split into 256 KB pieces. Each piece is individually addressed by its SHA-256 hash. Pieces form a Merkle tree; the tree's root hash lives in the envelope.

Why split it like this? Because it means:

- Fetching a channel's history is cheap. You download envelopes (tiny) and see the feed instantly.
- Big media loads on demand and in parallel from whoever's nearest. Your voice note can arrive from three different peers, one piece at a time.
- The UI can show a placeholder — *"🎤 voice message · loading 40%"* — and the user controls whether to wait.
- A single corrupt piece can be redownloaded; you don't lose the whole blob.

### Channels as Merkle DAGs

Envelopes are grouped into **chunks of 1000**. The first relay to see the 1000th envelope seals the chunk: signs it, hashes it, broadcasts the seal. Each chunk references the previous chunk's hash. A channel is therefore a **chain of sealed chunks**, each containing up to 1000 signed messages.

This is conceptually the same structure as a blockchain — but without mining, consensus, or energy waste. It is an append-only, cryptographically verifiable log, maintained by whichever relay happens to be around when the next chunk fills up.

### The swarm

Every node announces a **have list**: the chunks, blobs, and pieces it currently holds. When a node needs something, it sends a **want list** to its peers. Peers respond with what they can serve. Requests use a **rarest-first** strategy — if only two peers hold piece X, nodes that want it will request it first to avoid X becoming unavailable.

This is the same idea that makes BitTorrent robust. No single peer needs to hold everything. The network as a whole holds everything — many times over.

### Peer discovery

Finding peers when you don't know any is the chicken-and-egg of P2P networks. Muster tries a cascade:

1. **Last known peers** — the ones you talked to last time Muster was open. Persisted in your local storage.
2. **LAN discovery** — other Muster nodes on your local network (mDNS). Works even with no internet at all.
3. **Seed nodes** — a short list shipped in the app. Used only on first boot or total isolation.

Once connected, a **Kademlia Distributed Hash Table** (DHT) takes over. The DHT tells you who holds what. No central tracker is needed.

---

## Identity and trust

### Communities have owners

Each community has a root Ed25519 key — the owner. The owner signs a **manifest**: the community's name, description, admin roster, channel list, member list. The manifest is under 10 KB and replicates to every peer that holds any member's data.

Anyone receiving content for a community verifies it against the signed manifest. Forged content fails the signature check and is discarded.

### Admins are delegated

Owners don't sign every moderation action themselves. Instead, admins have their own Ed25519 keys, and the owner signs those keys into the manifest. Admins can then create channels, moderate members, seal chunks — everything except changing the admin roster itself. That last power stays with the owner.

If the owner goes dark, the community keeps running. If the owner loses their key, the admin roster is frozen — the community continues to operate but can't change its leadership. Members can socially migrate to a new community.

### Causal ordering of admin actions

Network time lies. NTP drifts. Offline nodes come back with stale clocks. So Muster doesn't order admin actions by wall time — it orders them by **cause and effect**.

Every admin action references the hash of the previous action its signer applied. If you promote Alice (action A) and then Alice bans user X (action B), then B references A. A node receiving B before A buffers it until A arrives. Two admins taking uncorrelated actions at the same time are resolved by a deterministic tiebreak (timestamp + node ID).

This borrows from how Git tracks commit parents. It is the simplest mechanism that gives every peer the same history, every time.

### DMs are sealed

Direct messages are end-to-end encrypted (X25519 / AES-256-GCM) and addressed to an **inbox hash** — a salted hash of the recipient's public key that rotates periodically. Peers cannot tell who the DM is for. Only the recipient can compute their own inbox hashes and recognise a DM as theirs.

DMs don't broadcast to the whole mesh. They flow to peers of the communities and squads the recipient is in, and to the most-trafficked nodes. This cuts network load without reducing deliverability.

### Public channels aren't readable by non-members

Even in a "public" community, channel content is encrypted at rest with a key shared among members. A node cache-seeding that community sees opaque bytes. Joining a community is what gives you the key.

This means "public" in Muster means "open to join" — not "world-readable without asking". A deliberate tradeoff for a Discord-style product.

---

## Keeping peers honest

A peer can lie and claim to hold content it doesn't have. Before trusting anyone's have list, Muster issues random **proof-of-storage challenges**: "hash me bytes 54321 to 59321 of chunk ABC". The peer must return the correct SHA-256 or lose reputation. Reputation factors into who we fetch from next. Persistent liars get ignored.

---

## Retention and cache

- **Hosted content** (for communities / squads your node owns): permanent. Never purged.
- **Network cache** (the 10% slot): LRU eviction, with priority given to content from communities you're a member of and content actively being requested by peers.
- **Network-wide floor**: **30 days**. Any content younger than 30 days should be retrievable from the swarm. Older content is guaranteed only if a dedicated node still hosts it or a member opted to pin it.
- **New joiners** to an existing community fetch the last 30 days by default. If the channel allows new-member history access, older content is served on-scroll — by whichever peer still has it.

## Bandwidth

Muster never fights your real traffic.

- At startup, measure your upload speed once.
- During swarm traffic, track round-trip time. If RTT doubles versus baseline, back off immediately.
- Hard cap: 10% of upload. User-configurable.

You can be a heavy gamer and a heavy Muster seeder at the same time. One doesn't notice the other.

---

## Voice chat

Voice channels are realtime, low-latency, and **not recorded**. Signalling (who's speaking to whom) goes through a relay; the audio itself flows peer-to-peer via WebRTC when possible, falling back to relay forwarding when NATs make direct connections impossible.

No swarm involvement. No storage. Once the conversation ends, it's gone.

Voice **messages** — the 10-second clips you drop in chat — are a different thing: those are recorded blobs, distributed like any other file.

---

## Anti-abuse

- **Fake have lists** → proof-of-storage challenges.
- **Chunk forgery** → Merkle verification, Ed25519 signatures, owner-signed manifests.
- **Spam** → per-channel rate limits, admin tools, op log tracking kicks and bans.
- **DM flooding** → inbox rate limits; recipients can block sender keys.
- **Sybil attacks** → proof-of-storage raises the cost of pretending to be useful; reputation accumulates over time.

---

## What this gives you

- **No vendor lock-in.** Your community's manifest and chunks are portable. Any node can host.
- **No data harvesting.** The operator of a cache-seeding node can't read the content they're helping to distribute.
- **Resilience.** Losing every main node still leaves a working network — communities keep going on member devices.
- **End-to-end encryption as a default, not a setting.** Public channels, private channels, DMs — all encrypted in motion and at rest. Membership is the key.
- **Predictable costs.** Running a dedicated node is a flat disk budget. No surprise bills. No growth-hacking.

---

## Current implementation status

As of **R24** (2026-04):

- [x] Ed25519 identity, X25519 / AES-GCM DM encryption, group E2E key ratchet
- [x] WebSocket relay with SQLite persistence
- [x] Mesh peer connections with PEX and bounded-window sync
- [x] Three-tier node model (configuration + limits)
- [x] Node discovery and fallback ordering (client-side)
- [x] Tauri desktop app with embedded relay and Node runtime sidecar
- [x] Web app (React) with voice, text, DMs, files
- [ ] Two-layer message / blob model (**Phase 1**)
- [ ] Signed community manifest + admin key delegation (**Phase 1**)
- [ ] Op log with causal ordering (**Phase 2**)
- [ ] Piece-based file protocol (**Phase 3**)
- [ ] BitSwap-lite chunk exchange (**Phase 4**)
- [ ] Kademlia DHT over WS (**Phase 5**)
- [ ] Proof-of-storage + peer reputation (**Phase 6**)
- [ ] Sealed-sender DM routing (**Phase 7**)
- [ ] Bandwidth monitor (**Phase 8**)
- [ ] Multi-device user sync (future)

---

## Glossary

- **Envelope** — signed metadata of a message (sender, time, channel, refs).
- **Blob** — the content a message points to (photo, voice, video, large text).
- **Piece** — a 256 KB slice of a blob, addressed by SHA-256.
- **Chunk** — 1000 envelopes sealed together; the unit of channel history.
- **Manifest** — the owner-signed description of a community.
- **Op log** — the causally ordered chain of admin actions for a community.
- **Swarm** — the set of peers currently holding any piece of a given community's content.
- **Inbox hash** — a salted hash of a user's public key used to route DMs without revealing identity.
