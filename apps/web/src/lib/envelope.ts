/**
 * Envelope builder / sender for the browser (R25 — Phase 1).
 *
 * Builds canonical CBOR envelopes, signs them, and hands them to the
 * transport. Blob bodies are encrypted and split into 256-KB pieces
 * before the envelope is finalised with the Merkle root.
 *
 * This module is behind the VITE_TWO_LAYER feature flag; the legacy
 * PUBLISH path keeps working for nodes that don't opt in.
 */

import {
  encodeCanonical,
  piecesOf,
  pieceId,
  merkleRoot,
  PIECE_SIZE,
  sha256,
  sign as signBytes,
  fromHex,
  toHex,
  toBase64,
} from '@muster/crypto';
import {
  toUnsignedCborMap,
  toCborMap,
  MAX_INLINE_CIPHERTEXT,
  MAX_INLINE_PLAINTEXT,
  type Envelope,
  type EnvelopeKind,
  type EnvelopeBody,
} from '@muster/protocol';

/** What the caller must provide. */
export interface BuildEnvelopeInput {
  communityId: Uint8Array;
  channelId: Uint8Array;
  senderPubkey: Uint8Array;
  senderPrivkey: Uint8Array;
  kind: EnvelopeKind;
  /** UTF-8 plaintext for text kinds, or the raw bytes for media. */
  payload: string | Uint8Array;
  /** For media/file/voice: IANA mime. */
  mime?: string;
  /** Group-key epoch used to seal the body. */
  epoch: number;
  /**
   * Encrypts `plaintext` under the group key, returns `{ ciphertext, nonce }`.
   * Caller wires in the existing @muster/crypto/e2e AES-256-GCM helper or
   * groupCryptoStore.encryptBytes.
   */
  encryptBody: (plaintext: Uint8Array) => Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }>;
  /**
   * Wraps a per-blob AES-256 key under the group key, returns `{ wrap, nonce }`.
   * Only called for non-inline bodies.
   */
  wrapBlobKey?: (blobKey: Uint8Array) => Promise<{ wrap: Uint8Array; nonce: Uint8Array }>;
  replyTo?: Uint8Array;
  edits?: Uint8Array;
  tombstones?: Uint8Array;
}

export interface BuiltEnvelope {
  envelope: Envelope;
  envelopeId: Uint8Array;
  cborBytes: Uint8Array;
  /** Present when body is a blob. Pieces are ciphertext bytes, already chunked. */
  blob?: {
    root: Uint8Array;
    size: number;
    mime: string;
    pieces: Uint8Array[];   // piece ciphertext — one per 256 KB of plaintext
    pieceIds: Uint8Array[]; // SHA-256 of each piece (ciphertext)
    blobKey: Uint8Array;    // AES-256 key used to encrypt the blob (must not be transmitted)
  };
}

/**
 * Build an envelope. For text kinds with small plaintext the body is inline;
 * otherwise the payload is encrypted + split into 256-KB pieces and the
 * envelope carries a BlobRef.
 */
export async function buildEnvelope(input: BuildEnvelopeInput): Promise<BuiltEnvelope> {
  const {
    communityId, channelId, senderPubkey, senderPrivkey,
    kind, payload, mime, epoch, encryptBody, wrapBlobKey,
    replyTo, edits, tombstones,
  } = input;

  // Normalise payload bytes.
  const payloadBytes =
    typeof payload === 'string'
      ? new TextEncoder().encode(payload)
      : payload;

  // Decide inline vs blob.
  let body: EnvelopeBody;
  let blobOut: BuiltEnvelope['blob'] | undefined;

  if (typeof payload === 'string' && payloadBytes.length <= MAX_INLINE_PLAINTEXT && kind === 'text') {
    // Inline ciphertext fits in a single packet.
    const { ciphertext, nonce } = await encryptBody(payloadBytes);
    if (ciphertext.length > MAX_INLINE_CIPHERTEXT) {
      throw new Error('envelope: inline ciphertext exceeded 4 KB after encryption');
    }
    body = { inline: true, ciphertext, nonce, epoch };
  } else {
    if (!wrapBlobKey) throw new Error('envelope: wrapBlobKey required for blob body');
    if (!mime) throw new Error('envelope: mime required for blob body');
    // Generate a per-blob AES-256 key.
    const blobKey = crypto.getRandomValues(new Uint8Array(32));
    // Encrypt the whole payload into a contiguous ciphertext stream. Phase 1
    // keeps this simple: one GCM pass over the full plaintext. Chunked GCM
    // per BLOB.md §Encryption is Phase 4 work (streaming decode).
    const { ciphertext: encBytes, nonce: encNonce } = await encryptWithKey(blobKey, payloadBytes);
    const cipherAll = concat(encNonce, encBytes); // prefix nonce so receiver can decrypt
    // Split into 256-KB pieces.
    const pieces = piecesOf(cipherAll);
    const pieceIds = pieces.map(pieceId);
    const root = merkleRoot(pieces);
    const { wrap, nonce: wrapNonce } = await wrapBlobKey(blobKey);
    body = {
      inline: false,
      blobRef: {
        root,
        size: cipherAll.length,
        mime,
        pieceCount: pieces.length,
        pieceSize: PIECE_SIZE,
        keyWrap: wrap,
        nonce: wrapNonce,
        epoch,
      },
    };
    blobOut = { root, size: cipherAll.length, mime, pieces, pieceIds, blobKey };
  }

  const base = {
    v: 1 as const,
    communityId,
    channelId,
    senderPubkey,
    ts: Date.now(),
    kind,
    body,
    ...(replyTo ? { replyTo } : {}),
    ...(edits ? { edits } : {}),
    ...(tombstones ? { tombstones } : {}),
  };

  const unsignedBytes = encodeCanonical(toUnsignedCborMap(base) as any);
  const sig = await signBytes(unsignedBytes, senderPrivkey);

  const envelope: Envelope = { ...base, sig };
  const cborBytes = encodeCanonical(toCborMap(envelope) as any);
  const envelopeId = sha256(cborBytes);

  return { envelope, envelopeId, cborBytes, blob: blobOut };
}

// ─── Transport helpers ─────────────────────────────────────────────────────

export interface EnvelopeTransport {
  send: (msg: any) => void;
  isConnected: boolean;
}

/**
 * Send a built envelope to the relay. If the envelope carries a blob,
 * announces it first then uploads pieces in parallel.
 */
export async function sendBuiltEnvelope(
  transport: EnvelopeTransport,
  built: BuiltEnvelope,
): Promise<void> {
  if (!transport.isConnected) throw new Error('envelope: transport not connected');

  if (built.blob) {
    transport.send({
      type: 'BLOB_ANNOUNCE',
      payload: {
        root: toHex(built.blob.root),
        size: built.blob.size,
        mime: built.blob.mime,
        pieceCount: built.blob.pieces.length,
        pieceSize: PIECE_SIZE,
      },
      timestamp: Date.now(),
    });
    for (let i = 0; i < built.blob.pieces.length; i++) {
      transport.send({
        type: 'PIECE_UPLOAD',
        payload: {
          blobRoot: toHex(built.blob.root),
          pieceIdx: i,
          bytes: toBase64(built.blob.pieces[i]!),
        },
        timestamp: Date.now(),
      });
    }
  }

  transport.send({
    type: 'ENVELOPE',
    payload: { cbor: toBase64(built.cborBytes) },
    timestamp: Date.now(),
  });
}

// ─── Internal ───────────────────────────────────────────────────────────────

async function encryptWithKey(key: Uint8Array, plaintext: Uint8Array): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  const subtle = (globalThis.crypto ?? window.crypto).subtle;
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await subtle.importKey('raw', key.buffer as ArrayBuffer, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer }, cryptoKey, plaintext.buffer as ArrayBuffer),
  );
  return { ciphertext: ct, nonce };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// ─── Re-exports for callers ─────────────────────────────────────────────────

export { fromHex, toHex, toBase64 };
