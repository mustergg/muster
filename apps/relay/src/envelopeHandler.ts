/**
 * envelopeHandler — Phase 1 dispatcher for two-layer model messages.
 *
 * Gated behind MUSTER_TWO_LAYER=1. Handles:
 *   - ENVELOPE         — accept + validate + store + forward
 *   - ENVELOPE_HISTORY — request channel history since ts
 *   - PIECE_UPLOAD     — store ciphertext piece
 *   - PIECE_REQUEST    — serve a piece by id
 *   - BLOB_ANNOUNCE    — register blob metadata (root, size, mime, pieces)
 *
 * Wire framing: each carries `payload.cbor = base64(canonicalCBOR(...))`.
 * The relay does NOT decrypt envelope bodies — opaque ciphertext only.
 */

import type { WebSocket } from 'ws';
import {
  decodeCanonical,
  encodeCanonical,
  fromHex,
  toHex,
  pieceId as computePieceId,
  PIECE_SIZE,
  sha256,
  verify as ed25519Verify,
} from '@muster/crypto';
import {
  fromCborMap,
  toUnsignedCborMap,
  toCborMap,
  CLOCK_SKEW_MS,
  MAX_INLINE_CIPHERTEXT,
  MAX_MIME_LEN,
  type Envelope,
} from '@muster/protocol';
import type { RelayClient } from './types';
import type { EnvelopeDB } from './envelopeDB';
import type { BlobDB } from './blobDB';

type Send = (client: RelayClient, msg: any) => void;

/** Returns true if the message was claimed by this handler. */
export function handleEnvelopeMessage(
  client: RelayClient,
  msg: any,
  envelopeDB: EnvelopeDB,
  blobDB: BlobDB,
  sendToClient: Send,
  channels: Map<string, Set<WebSocket>>,
  clients: Map<WebSocket, RelayClient>,
): boolean {
  switch (msg.type) {
    case 'ENVELOPE':
      // Fire and forget — async signature verification.
      void handleEnvelope(client, msg, envelopeDB, blobDB, sendToClient, channels, clients);
      return true;
    case 'ENVELOPE_HISTORY':
      handleEnvelopeHistory(client, msg, envelopeDB, sendToClient);
      return true;
    case 'PIECE_UPLOAD':
      handlePieceUpload(client, msg, blobDB, sendToClient);
      return true;
    case 'PIECE_REQUEST':
      handlePieceRequest(client, msg, blobDB, sendToClient);
      return true;
    case 'BLOB_ANNOUNCE':
      handleBlobAnnounce(client, msg, blobDB, sendToClient);
      return true;
    default:
      return false;
  }
}

// ─── ENVELOPE ──────────────────────────────────────────────────────────────

async function handleEnvelope(
  client: RelayClient,
  msg: any,
  envelopeDB: EnvelopeDB,
  blobDB: BlobDB,
  sendToClient: Send,
  channels: Map<string, Set<WebSocket>>,
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

  let env: Envelope;
  try {
    const map = decodeCanonical(cborBytes) as Record<string, unknown>;
    env = fromCborMap(map);
  } catch (err: any) {
    return reject(client, sendToClient, msg, `decode failed: ${err.message}`);
  }

  // 1. Version
  if (env.v !== 1) return reject(client, sendToClient, msg, 'bad version');

  // 2. Sender pubkey matches the authenticated client (no impersonation)
  const senderHex = toHex(env.senderPubkey);
  if (senderHex !== client.publicKey?.toLowerCase()) {
    return reject(client, sendToClient, msg, 'sender mismatch');
  }

  // 3. Signature
  if (!(await verifyEnvelopeSig(env))) {
    return reject(client, sendToClient, msg, 'bad signature');
  }

  // 4. Clock skew
  const now = Date.now();
  if (Math.abs(env.ts - now) > CLOCK_SKEW_MS) {
    return reject(client, sendToClient, msg, 'ts out of window');
  }

  // 5. Body shape sanity (community membership/channel-exists checks
  //    will land in Phase 2 once manifests are signed and replicated).
  if (env.body.inline) {
    if (env.body.ciphertext.length > MAX_INLINE_CIPHERTEXT) {
      return reject(client, sendToClient, msg, 'inline body too large');
    }
    if (env.body.nonce.length !== 12) {
      return reject(client, sendToClient, msg, 'bad nonce length');
    }
  } else {
    const br = env.body.blobRef;
    if (br.pieceSize !== PIECE_SIZE) {
      return reject(client, sendToClient, msg, 'bad pieceSize');
    }
    if (br.mime.length > MAX_MIME_LEN) {
      return reject(client, sendToClient, msg, 'mime too long');
    }
    // Register the blob metadata if not yet known. Pieces will arrive
    // via PIECE_UPLOAD (sender) or BitSwap (Phase 5).
    blobDB.storeBlob({
      root: Buffer.from(br.root),
      size: br.size,
      mime: br.mime,
      pieceCount: br.pieceCount,
      pieceSize: br.pieceSize,
      firstSeenAt: Date.now(),
    });
  }

  // 6. Compute canonical envelopeId and store
  const envelopeIdBytes = sha256(encodeCanonical(toCborMap(env) as any));
  const stored = envelopeDB.store({
    envelopeId: Buffer.from(envelopeIdBytes),
    communityId: Buffer.from(env.communityId),
    channelId: Buffer.from(env.channelId),
    senderPubkey: Buffer.from(env.senderPubkey),
    ts: env.ts,
    kind: env.kind,
    hasBlob: env.body.inline ? 0 : 1,
    blobRoot: env.body.inline ? null : Buffer.from((env.body as any).blobRef.root),
    replyTo: env.replyTo ? Buffer.from(env.replyTo) : null,
    edits: env.edits ? Buffer.from(env.edits) : null,
    tombstones: env.tombstones ? Buffer.from(env.tombstones) : null,
    cbor: Buffer.from(cborBytes),
    receivedAt: Date.now(),
  });

  if (!stored) {
    // duplicate — silently ack and stop
    sendToClient(client, { type: 'ENVELOPE_ACK', payload: { envelopeId: toHex(envelopeIdBytes), duplicate: true }, timestamp: Date.now() });
    return;
  }

  sendToClient(client, { type: 'ENVELOPE_ACK', payload: { envelopeId: toHex(envelopeIdBytes), duplicate: false }, timestamp: Date.now() });

  // Forward to channel subscribers (legacy channel routing — channelId is
  // bytes here, but the legacy `channels` map uses string keys).
  const channelKey = toHex(env.channelId);
  const subs = channels.get(channelKey);
  if (subs) {
    const broadcast = { type: 'ENVELOPE', payload: { cbor: cborB64 }, timestamp: Date.now() };
    for (const ws of subs) {
      if (ws === client.ws) continue;
      const peer = clients.get(ws);
      if (peer && peer.authenticated) sendToClient(peer, broadcast);
    }
  }
}

// ─── ENVELOPE_HISTORY ──────────────────────────────────────────────────────

function handleEnvelopeHistory(
  client: RelayClient,
  msg: any,
  envelopeDB: EnvelopeDB,
  sendToClient: Send,
): void {
  const channelHex = msg.payload?.channelId;
  const since = Number(msg.payload?.since ?? 0);
  const limit = Math.min(Number(msg.payload?.limit ?? 500), 1000);
  if (typeof channelHex !== 'string' || !/^[0-9a-f]+$/i.test(channelHex)) {
    return reject(client, sendToClient, msg, 'bad channelId');
  }
  let channelBytes: Uint8Array;
  try { channelBytes = fromHex(channelHex); } catch { return reject(client, sendToClient, msg, 'bad hex'); }
  const rows = envelopeDB.getByChannel(Buffer.from(channelBytes), since, limit);
  const envelopes = rows.map((r) => ({
    envelopeId: r.envelopeId.toString('hex'),
    cbor: r.cbor.toString('base64'),
  }));
  sendToClient(client, {
    type: 'ENVELOPE_HISTORY_RESPONSE',
    payload: { channelId: channelHex, envelopes, count: envelopes.length },
    timestamp: Date.now(),
  });
}

// ─── PIECE_UPLOAD ──────────────────────────────────────────────────────────

function handlePieceUpload(
  client: RelayClient,
  msg: any,
  blobDB: BlobDB,
  sendToClient: Send,
): void {
  const blobRootHex = msg.payload?.blobRoot;
  const pieceIdx = Number(msg.payload?.pieceIdx);
  const bytesB64 = msg.payload?.bytes;
  if (typeof blobRootHex !== 'string' || !Number.isInteger(pieceIdx) || pieceIdx < 0 || typeof bytesB64 !== 'string') {
    return reject(client, sendToClient, msg, 'bad piece upload');
  }
  let bytes: Uint8Array;
  try { bytes = base64Decode(bytesB64); } catch { return reject(client, sendToClient, msg, 'bad base64'); }
  if (bytes.length === 0 || bytes.length > PIECE_SIZE) {
    return reject(client, sendToClient, msg, 'bad piece size');
  }
  const blobRoot = Buffer.from(fromHex(blobRootHex));
  const blob = blobDB.getBlob(blobRoot);
  if (!blob) return reject(client, sendToClient, msg, 'unknown blob root');
  if (pieceIdx >= blob.pieceCount) return reject(client, sendToClient, msg, 'pieceIdx out of range');

  const id = computePieceId(bytes);
  blobDB.upsertPiece({
    pieceId: Buffer.from(id),
    bytes: Buffer.from(bytes),
    size: bytes.length,
    refCount: 0,
    lastAccessedAt: Date.now(),
  });
  blobDB.linkPiece(blobRoot, pieceIdx, Buffer.from(id));

  sendToClient(client, {
    type: 'PIECE_UPLOAD_ACK',
    payload: {
      blobRoot: blobRootHex,
      pieceIdx,
      pieceId: toHex(id),
      complete: blobDB.isBlobComplete(blobRoot),
    },
    timestamp: Date.now(),
  });
}

// ─── PIECE_REQUEST ─────────────────────────────────────────────────────────

function handlePieceRequest(
  client: RelayClient,
  msg: any,
  blobDB: BlobDB,
  sendToClient: Send,
): void {
  const pieceIdHex = msg.payload?.pieceId;
  if (typeof pieceIdHex !== 'string' || !/^[0-9a-f]+$/i.test(pieceIdHex)) {
    return reject(client, sendToClient, msg, 'bad pieceId');
  }
  const piece = blobDB.getPiece(Buffer.from(fromHex(pieceIdHex)));
  if (!piece) {
    sendToClient(client, {
      type: 'PIECE_RESPONSE',
      payload: { pieceId: pieceIdHex, notHave: true },
      timestamp: Date.now(),
    });
    return;
  }
  sendToClient(client, {
    type: 'PIECE_RESPONSE',
    payload: { pieceId: pieceIdHex, bytes: piece.bytes.toString('base64') },
    timestamp: Date.now(),
  });
}

// ─── BLOB_ANNOUNCE ─────────────────────────────────────────────────────────

function handleBlobAnnounce(
  client: RelayClient,
  msg: any,
  blobDB: BlobDB,
  sendToClient: Send,
): void {
  const p = msg.payload ?? {};
  const root = typeof p.root === 'string' ? Buffer.from(fromHex(p.root)) : null;
  if (!root) return reject(client, sendToClient, msg, 'bad root');
  if (typeof p.size !== 'number' || typeof p.mime !== 'string' || typeof p.pieceCount !== 'number') {
    return reject(client, sendToClient, msg, 'bad blob fields');
  }
  blobDB.storeBlob({
    root,
    size: p.size,
    mime: p.mime,
    pieceCount: p.pieceCount,
    pieceSize: typeof p.pieceSize === 'number' ? p.pieceSize : PIECE_SIZE,
    firstSeenAt: Date.now(),
  });
  sendToClient(client, { type: 'BLOB_ANNOUNCE_ACK', payload: { root: p.root }, timestamp: Date.now() });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function reject(client: RelayClient, send: Send, msg: any, reason: string): void {
  if (process.env.MUSTER_TWO_LAYER_DEBUG) {
    console.warn(`[envelope] reject ${msg?.type}: ${reason}`);
  }
  send(client, { type: 'ENVELOPE_ERROR', payload: { reason, originalType: msg?.type }, timestamp: Date.now() });
}

async function verifyEnvelopeSig(env: Envelope): Promise<boolean> {
  try {
    const unsignedBytes = encodeCanonical(toUnsignedCborMap(env) as any);
    return await ed25519Verify(env.sig, unsignedBytes, env.senderPubkey);
  } catch {
    return false;
  }
}

function base64Decode(s: string): Uint8Array {
  // Node has Buffer; browser path is not used here (this is the relay).
  return new Uint8Array(Buffer.from(s, 'base64'));
}
