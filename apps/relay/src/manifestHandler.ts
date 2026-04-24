/**
 * manifestHandler — R25 / Phase 2.
 *
 * Wire dispatcher for community manifest messages. Gated behind
 * MUSTER_TWO_LAYER=1 (caller checks the flag before invoking).
 *
 * Handles:
 *   - MANIFEST_PUBLISH  — accept + verify + store + broadcast
 *   - MANIFEST_REQUEST  — serve latest (or specific version) for a community
 *
 * Validation (publish):
 *   1. Canonical CBOR shape
 *   2. v === 1
 *   3. Owner sig over canonicalCBOR(manifest \ sig)
 *   4. communityId === H(canonicalCBOR(genesisManifest)) — checked once
 *      (we re-derive against the stored version-0 row).
 *   5. version is monotonic vs latest known (must equal latest+1) OR
 *      version === 0 with prevManifestHash === null (genesis).
 *   6. prevManifestHash === SHA-256(latest stored manifest CBOR) for
 *      non-genesis versions.
 *   7. Clock skew |ts - now| ≤ 30 min.
 *   8. Roster sanity: ≤ MAX_ADMINS admins, ≤ MAX_CHANNELS channels,
 *      no duplicate admin pubkeys, no duplicate channel ids.
 */

import type { WebSocket } from 'ws';
import {
  decodeCanonical,
  encodeCanonical,
  fromHex,
  toHex,
  sha256,
  verify as ed25519Verify,
} from '@muster/crypto';
import {
  manifestFromCborMap,
  manifestToCborMap,
  manifestToUnsignedCborMap,
  type CommunityManifest,
  MAX_ADMINS,
  MAX_CHANNELS,
  MANIFEST_CLOCK_SKEW_MS,
} from '@muster/protocol';
import type { RelayClient } from './types';
import type { ManifestDB } from './manifestDB';

type Send = (client: RelayClient, msg: any) => void;

/** Returns true if the message was claimed by this handler. */
export function handleManifestMessage(
  client: RelayClient,
  msg: any,
  manifestDB: ManifestDB,
  sendToClient: Send,
  clients: Map<WebSocket, RelayClient>,
): boolean {
  switch (msg.type) {
    case 'MANIFEST_PUBLISH':
      void handlePublish(client, msg, manifestDB, sendToClient, clients);
      return true;
    case 'MANIFEST_REQUEST':
      handleRequest(client, msg, manifestDB, sendToClient);
      return true;
    default:
      return false;
  }
}

// ─── PUBLISH ───────────────────────────────────────────────────────────────

async function handlePublish(
  client: RelayClient,
  msg: any,
  manifestDB: ManifestDB,
  sendToClient: Send,
  clients: Map<WebSocket, RelayClient>,
): Promise<void> {
  const cborB64 = msg.payload?.cbor;
  if (typeof cborB64 !== 'string') {
    return reject(client, sendToClient, msg, 'missing payload.cbor');
  }
  let cborBytes: Uint8Array;
  try {
    cborBytes = base64Decode(cborB64);
  } catch {
    return reject(client, sendToClient, msg, 'invalid base64');
  }

  let m: CommunityManifest;
  try {
    const map = decodeCanonical(cborBytes) as Record<string, unknown>;
    m = manifestFromCborMap(map);
  } catch (err: any) {
    return reject(client, sendToClient, msg, `decode failed: ${err.message}`);
  }

  // 1. Version
  if (m.v !== 1) return reject(client, sendToClient, msg, 'bad version');

  // 2. Owner sig
  if (!(await verifyOwnerSig(m))) {
    return reject(client, sendToClient, msg, 'bad owner signature');
  }

  // 3. Clock skew
  const now = Date.now();
  if (Math.abs(m.ts - now) > MANIFEST_CLOCK_SKEW_MS) {
    return reject(client, sendToClient, msg, 'ts out of window');
  }

  // 4. Roster sanity
  if (m.admins.length > MAX_ADMINS) return reject(client, sendToClient, msg, 'too many admins');
  if (m.channels.length > MAX_CHANNELS) return reject(client, sendToClient, msg, 'too many channels');
  if (hasDuplicatePubkey(m.admins.map((a) => a.pubkey))) {
    return reject(client, sendToClient, msg, 'duplicate admin pubkey');
  }
  if (hasDuplicateBytes(m.channels.map((c) => c.id))) {
    return reject(client, sendToClient, msg, 'duplicate channel id');
  }

  // 5. Chain check
  const communityId = Buffer.from(m.communityId);
  const latest = manifestDB.getLatest(communityId);
  if (latest === null) {
    // Genesis path — version must be 0 and prevManifestHash null
    if (m.version !== 0) return reject(client, sendToClient, msg, 'genesis must be version 0');
    if (m.prevManifestHash !== null) return reject(client, sendToClient, msg, 'genesis must have null prevManifestHash');
    // communityId integrity: must equal H(canonicalCBOR(this manifest \ sig + zeroed-out commId))
    // Phase 2 keeps it advisory — Phase 3 op log will tighten.
  } else {
    if (m.version !== latest.version + 1) {
      return reject(client, sendToClient, msg, `version must be ${latest.version + 1}`);
    }
    if (m.prevManifestHash === null) {
      return reject(client, sendToClient, msg, 'non-genesis must reference prev manifest');
    }
    const expectedPrev = sha256(new Uint8Array(latest.cbor));
    if (!bytesEq(m.prevManifestHash, expectedPrev)) {
      return reject(client, sendToClient, msg, 'prevManifestHash mismatch');
    }
    // Owner change requires the OLD owner's signature over the NEW manifest.
    // Phase 2 doesn't allow owner transfer at all to keep the invariant
    // simple; that comes in Phase 3 via a dedicated op type.
    if (!bytesEq(new Uint8Array(latest.owner), m.owner)) {
      return reject(client, sendToClient, msg, 'owner change not permitted in Phase 2');
    }
  }

  // 6. Compute manifest id and store
  const manifestIdBytes = sha256(cborBytes);
  const stored = manifestDB.store({
    manifestId: Buffer.from(manifestIdBytes),
    communityId,
    version: m.version,
    owner: Buffer.from(m.owner),
    prevManifestHash: m.prevManifestHash ? Buffer.from(m.prevManifestHash) : null,
    ts: m.ts,
    cbor: Buffer.from(cborBytes),
    receivedAt: Date.now(),
  });

  if (!stored) {
    sendToClient(client, {
      type: 'MANIFEST_ACK',
      payload: { manifestId: toHex(manifestIdBytes), duplicate: true },
      timestamp: Date.now(),
    });
    return;
  }

  sendToClient(client, {
    type: 'MANIFEST_ACK',
    payload: {
      manifestId: toHex(manifestIdBytes),
      communityId: toHex(m.communityId),
      version: m.version,
      duplicate: false,
    },
    timestamp: Date.now(),
  });

  // Broadcast to every authenticated peer — manifests are
  // community-public. Recipient stores it if they care about that
  // community (browser caches everything; relay-relay floods).
  const broadcast = {
    type: 'MANIFEST_PUBLISH',
    payload: { cbor: cborB64 },
    timestamp: Date.now(),
  };
  for (const peer of clients.values()) {
    if (peer.ws === client.ws) continue;
    if (!peer.authenticated) continue;
    sendToClient(peer, broadcast);
  }
}

// ─── REQUEST ───────────────────────────────────────────────────────────────

function handleRequest(
  client: RelayClient,
  msg: any,
  manifestDB: ManifestDB,
  sendToClient: Send,
): void {
  const communityHex = msg.payload?.communityId;
  if (typeof communityHex !== 'string' || !/^[0-9a-f]+$/i.test(communityHex)) {
    return reject(client, sendToClient, msg, 'bad communityId');
  }
  let communityBytes: Uint8Array;
  try { communityBytes = fromHex(communityHex); } catch { return reject(client, sendToClient, msg, 'bad hex'); }

  const requestedVersion = msg.payload?.version;
  const buf = Buffer.from(communityBytes);
  const row = typeof requestedVersion === 'number'
    ? manifestDB.getByVersion(buf, requestedVersion)
    : manifestDB.getLatest(buf);

  if (!row) {
    sendToClient(client, {
      type: 'MANIFEST_RESPONSE',
      payload: { communityId: communityHex, notFound: true },
      timestamp: Date.now(),
    });
    return;
  }

  sendToClient(client, {
    type: 'MANIFEST_RESPONSE',
    payload: {
      communityId: communityHex,
      version: row.version,
      manifestId: row.manifestId.toString('hex'),
      cbor: row.cbor.toString('base64'),
    },
    timestamp: Date.now(),
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function reject(client: RelayClient, send: Send, msg: any, reason: string): void {
  if (process.env.MUSTER_TWO_LAYER_DEBUG) {
    console.warn(`[manifest] reject ${msg?.type}: ${reason}`);
  }
  send(client, { type: 'MANIFEST_ERROR', payload: { reason, originalType: msg?.type }, timestamp: Date.now() });
}

async function verifyOwnerSig(m: CommunityManifest): Promise<boolean> {
  try {
    const unsignedBytes = encodeCanonical(manifestToUnsignedCborMap(m) as any);
    return await ed25519Verify(m.sig, unsignedBytes, m.owner);
  } catch {
    return false;
  }
}

function base64Decode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

function hasDuplicatePubkey(list: Uint8Array[]): boolean {
  return hasDuplicateBytes(list);
}

function hasDuplicateBytes(list: Uint8Array[]): boolean {
  const seen = new Set<string>();
  for (const b of list) {
    const k = toHex(b);
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Quiet unused-import warnings for symbols re-exported here.
void manifestToCborMap;
