/**
 * @muster/protocol/envelope — two-layer content model (R25 / Phase 1).
 *
 * Wire spec: docs/specs/ENVELOPE.md and docs/specs/BLOB.md.
 *
 * An Envelope carries signed metadata + either inline ciphertext (≤ 4 KB)
 * or a BlobRef pointing at a content-addressed blob served by the swarm.
 *
 * Encoding: canonical CBOR for anything signed. On the transport layer
 * (WebSocket) the envelope is still wrapped in a JSON frame as
 *   { type: 'ENVELOPE', payload: { cbor: <base64> } }
 * for backward compatibility with the legacy dispatcher.
 */

// ─── Kinds ──────────────────────────────────────────────────────────────────

export type EnvelopeKind =
  | 'text'
  | 'voice'
  | 'file'
  | 'image'
  | 'edit'
  | 'tombstone'
  | 'system';

// ─── Body shapes ────────────────────────────────────────────────────────────

/** Inline ciphertext body — total ciphertext ≤ 4096 bytes. */
export interface InlineBody {
  inline: true;
  /** AES-256-GCM ciphertext sealed under the community group key. */
  ciphertext: Uint8Array;
  /** 12-byte GCM nonce. */
  nonce: Uint8Array;
  /** Group-key epoch used to seal this body. */
  epoch: number;
}

/** Blob reference — the actual bytes live in the piece store. */
export interface BlobRef {
  /** 32-byte Merkle root of the blob pieces. */
  root: Uint8Array;
  /** Total plaintext size in bytes. */
  size: number;
  /** IANA media type, e.g. "image/png". */
  mime: string;
  /** Number of 256-KB pieces. */
  pieceCount: number;
  /** Always 262144 for spec-v1. */
  pieceSize: number;
  /** AES-GCM-wrapped blob key, sealed under the community group key. */
  keyWrap: Uint8Array;
  /** 12-byte GCM nonce for keyWrap. */
  nonce: Uint8Array;
  /** Group-key epoch that wrapped this blob key. */
  epoch: number;
}

export interface BlobBody {
  inline: false;
  blobRef: BlobRef;
}

export type EnvelopeBody = InlineBody | BlobBody;

// ─── Envelope ───────────────────────────────────────────────────────────────

/**
 * Canonical Envelope shape. All fields are required except the optional
 * relational refs at the bottom.
 *
 * Byte-typed fields (pubkeys, ids, signatures, ciphertext) are Uint8Array
 * in memory and byteString on the wire. String-typed fields are plain UTF-8.
 */
export interface Envelope {
  /** Spec version. */
  v: 1;
  /** 32-byte community ID. */
  communityId: Uint8Array;
  /** 32-byte channel ID. */
  channelId: Uint8Array;
  /** 32-byte Ed25519 public key of the sender. */
  senderPubkey: Uint8Array;
  /** Milliseconds since Unix epoch. */
  ts: number;
  /** What kind of message this envelope carries. */
  kind: EnvelopeKind;
  /** Inline ciphertext or a blob reference — never both. */
  body: EnvelopeBody;
  /** envelopeId of the parent message this replies to. */
  replyTo?: Uint8Array;
  /** envelopeId this envelope supersedes (edit). */
  edits?: Uint8Array;
  /** envelopeId this envelope deletes (tombstone). */
  tombstones?: Uint8Array;
  /** 64-byte Ed25519 signature over canonicalCBOR(envelope \ sig). */
  sig: Uint8Array;
}

/** The signed envelope with the sig stripped — the exact shape signed. */
export type UnsignedEnvelope = Omit<Envelope, 'sig'>;

// ─── Limits (spec-v1) ───────────────────────────────────────────────────────

export const ENVELOPE_V = 1;
export const MAX_INLINE_CIPHERTEXT = 4096; // bytes
export const MAX_INLINE_PLAINTEXT = 4000;  // bytes; leaves GCM overhead
export const CLOCK_SKEW_MS = 5 * 60 * 1000; // ±5 min
export const PARENT_WAIT_MS = 30 * 1000;
export const MAX_MIME_LEN = 255;

// ─── CBOR field keys ────────────────────────────────────────────────────────

/**
 * Field key literals — exported so encoders, decoders, and validators agree.
 * The CBOR encoder sorts keys bytewise; these literals just document shape.
 */
export const ENV_FIELDS = {
  v: 'v',
  communityId: 'communityId',
  channelId: 'channelId',
  senderPubkey: 'senderPubkey',
  ts: 'ts',
  kind: 'kind',
  body: 'body',
  replyTo: 'replyTo',
  edits: 'edits',
  tombstones: 'tombstones',
  sig: 'sig',
} as const;

// ─── Canonical Envelope ID ──────────────────────────────────────────────────

/**
 * Serialise an envelope (including its sig) to canonical CBOR.
 * envelopeId = SHA-256(canonicalCBOR(envelope))
 *
 * Hoisted up here so encoders/decoders in protocol and relay share the
 * exact same shape. Actual hashing is done by callers using `sha256`
 * from @muster/crypto.
 */
export function toCborMap(env: Envelope): Record<string, unknown> {
  const out: Record<string, unknown> = {
    v: env.v,
    communityId: env.communityId,
    channelId: env.channelId,
    senderPubkey: env.senderPubkey,
    ts: env.ts,
    kind: env.kind,
    body: bodyToCbor(env.body),
    sig: env.sig,
  };
  if (env.replyTo) out.replyTo = env.replyTo;
  if (env.edits) out.edits = env.edits;
  if (env.tombstones) out.tombstones = env.tombstones;
  return out;
}

export function toUnsignedCborMap(env: UnsignedEnvelope): Record<string, unknown> {
  const out: Record<string, unknown> = {
    v: env.v,
    communityId: env.communityId,
    channelId: env.channelId,
    senderPubkey: env.senderPubkey,
    ts: env.ts,
    kind: env.kind,
    body: bodyToCbor(env.body),
  };
  if (env.replyTo) out.replyTo = env.replyTo;
  if (env.edits) out.edits = env.edits;
  if (env.tombstones) out.tombstones = env.tombstones;
  return out;
}

function bodyToCbor(body: EnvelopeBody): Record<string, unknown> {
  if (body.inline) {
    return {
      inline: true,
      ciphertext: body.ciphertext,
      nonce: body.nonce,
      epoch: body.epoch,
    };
  }
  return {
    inline: false,
    blobRef: {
      root: body.blobRef.root,
      size: body.blobRef.size,
      mime: body.blobRef.mime,
      pieceCount: body.blobRef.pieceCount,
      pieceSize: body.blobRef.pieceSize,
      keyWrap: body.blobRef.keyWrap,
      nonce: body.blobRef.nonce,
      epoch: body.blobRef.epoch,
    },
  };
}

export function fromCborMap(map: Record<string, unknown>): Envelope {
  const body = cborToBody(map.body as Record<string, unknown>);
  const env: Envelope = {
    v: 1,
    communityId: asBytes(map.communityId, 'communityId'),
    channelId: asBytes(map.channelId, 'channelId'),
    senderPubkey: asBytes(map.senderPubkey, 'senderPubkey'),
    ts: asNumber(map.ts, 'ts'),
    kind: asKind(map.kind),
    body,
    sig: asBytes(map.sig, 'sig'),
  };
  if (map.replyTo) env.replyTo = asBytes(map.replyTo, 'replyTo');
  if (map.edits) env.edits = asBytes(map.edits, 'edits');
  if (map.tombstones) env.tombstones = asBytes(map.tombstones, 'tombstones');
  return env;
}

function cborToBody(m: Record<string, unknown>): EnvelopeBody {
  if (m.inline === true) {
    return {
      inline: true,
      ciphertext: asBytes(m.ciphertext, 'ciphertext'),
      nonce: asBytes(m.nonce, 'nonce'),
      epoch: asNumber(m.epoch, 'epoch'),
    };
  }
  const br = m.blobRef as Record<string, unknown>;
  if (!br) throw new Error('envelope: blob body missing blobRef');
  return {
    inline: false,
    blobRef: {
      root: asBytes(br.root, 'root'),
      size: asNumber(br.size, 'size'),
      mime: String(br.mime),
      pieceCount: asNumber(br.pieceCount, 'pieceCount'),
      pieceSize: asNumber(br.pieceSize, 'pieceSize'),
      keyWrap: asBytes(br.keyWrap, 'keyWrap'),
      nonce: asBytes(br.nonce, 'nonce'),
      epoch: asNumber(br.epoch, 'epoch'),
    },
  };
}

function asBytes(v: unknown, name: string): Uint8Array {
  if (v instanceof Uint8Array) return v;
  throw new Error(`envelope: field ${name} must be bytes`);
}

function asNumber(v: unknown, name: string): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  throw new Error(`envelope: field ${name} must be a number`);
}

function asKind(v: unknown): EnvelopeKind {
  const allowed: EnvelopeKind[] = ['text', 'voice', 'file', 'image', 'edit', 'tombstone', 'system'];
  if (typeof v === 'string' && (allowed as string[]).includes(v)) return v as EnvelopeKind;
  throw new Error(`envelope: unknown kind ${String(v)}`);
}
