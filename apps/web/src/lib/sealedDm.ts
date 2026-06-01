/**
 * sealedDm — R25 / Phase 8 (browser side).
 *
 * Builds and opens sealed-sender DM frames. The relay only ever sees the
 * recipient's rotating inbox hash and an opaque ciphertext — never the
 * plaintext sender or recipient pubkey.
 *
 * Flow (sender):
 *   recipientX   = edPublicToX25519(recipientEdPub)
 *   inbox        = inboxHash(recipientEdPub, currentWindowStart)
 *   ephemeral    = randomX25519KeyPair()
 *   shared       = ECDH(ephemeral.priv, recipientX)
 *   key          = deriveSealedDmKey(shared, inbox)
 *   ciphertext   = AES-256-GCM(key, nonce, canonical DmPayload)
 *   frame        = { v, inboxHash:inbox, senderEphemeralPub, nonce, ciphertext, ts, padding }
 *
 * Flow (recipient), on DM_DELIVER:
 *   shared       = ECDH(myX25519priv, frame.senderEphemeralPub)
 *   key          = deriveSealedDmKey(shared, frame.inboxHash)
 *   payload      = open(key, frame.nonce, frame.ciphertext)
 *   → reveals { messageId, senderPubkey, content, ts }
 *
 * The sender pubkey lives *inside* the sealed payload, so a passive relay
 * can't link sender↔recipient. See docs/specs/DM.md.
 */

import {
  encodeCanonical,
  decodeCanonical,
  toHex,
  fromHex,
  type CborValue,
} from '@muster/crypto';
import {
  edPublicToX25519,
  edPrivateToX25519,
  computeSharedSecret,
  deriveSealedDmKey,
  randomX25519KeyPair,
  sealBytes,
  openBytes,
  inboxHash,
  inboxWindowStart,
} from '@muster/crypto/e2e';
import {
  DM_V,
  dmFrameToCborMap,
  dmFrameFromCborMap,
  pickDmBucket,
  dmPaddingLen,
  type DmFrame,
} from '@muster/protocol';

/** Attachment descriptor carried inside a sealed DM (E2E, so the raw blob
 *  key travels here directly). The ciphertext lives in the content-addressed
 *  piece store, fetched by root. */
export interface SealedDmAttachment {
  root: string;       // blob root, hex
  size: number;       // ciphertext stream length
  mime: string;
  name: string;
  pieceCount: number;
  key: string;        // raw AES-256 key, hex
}

/** Sealed plaintext. Kept compact (single-letter keys) to fit small buckets. */
interface SealedDmPayload {
  /** messageId (shared with the legacy SEND_DM path for dedup). */
  i: string;
  /** sender Ed25519 pubkey, hex. */
  s: string;
  /** plaintext content. */
  c: string;
  /** sender wall-clock ms. */
  t: number;
  /** optional attachment descriptor. */
  a?: SealedDmAttachment;
}

export interface BuiltDmFrame {
  frame: DmFrame;
  /** base64(canonicalCBOR(frame)) — ready for the DM_FRAME wire payload. */
  cborB64: string;
}

/**
 * Build a sealed DM frame addressed to `recipientEdPubHex` for the current
 * 6h window. Returns null if the message is too large for the largest
 * padding bucket (caller should fall back to a blob body — not yet wired).
 */
export function buildSealedDmFrame(args: {
  recipientEdPubHex: string;
  senderEdPubHex: string;
  messageId: string;
  content: string;
  attachment?: SealedDmAttachment;
  nowMs?: number;
}): BuiltDmFrame | null {
  const now = args.nowMs ?? Date.now();
  const recipientEdPub = fromHex(args.recipientEdPubHex);
  const inbox = inboxHash(recipientEdPub, inboxWindowStart(now));

  const recipientX = edPublicToX25519(recipientEdPub);
  const ephemeral = randomX25519KeyPair();
  const shared = computeSharedSecret(ephemeral.privateKey, recipientX);
  const key = deriveSealedDmKey(shared, inbox);

  const payload: SealedDmPayload = { i: args.messageId, s: args.senderEdPubHex, c: args.content, t: now };
  if (args.attachment) payload.a = args.attachment;
  const plaintext = encodeCanonical(payload as unknown as CborValue);

  const { nonce, ciphertext } = sealBytes(key, new Uint8Array(plaintext));

  const bucket = pickDmBucket(ciphertext.length);
  if (bucket === null) return null; // too big for inline DM
  const padLen = dmPaddingLen(ciphertext.length, bucket);
  const padding = padLen > 0 ? crypto.getRandomValues(new Uint8Array(padLen)) : new Uint8Array(0);

  const frame: DmFrame = {
    v: DM_V,
    inboxHash: inbox,
    senderEphemeralPub: ephemeral.publicKey,
    nonce,
    ciphertext,
    ts: now,
    padding,
  };
  const cborB64 = bytesToB64(encodeCanonical(dmFrameToCborMap(frame) as CborValue));
  return { frame, cborB64 };
}

/**
 * Open a sealed DM frame received via DM_DELIVER. `myEdSeed` is the local
 * Ed25519 private seed (32 bytes). Returns the revealed payload or null on
 * failure (not addressed to us / corrupt / replay).
 */
export function openSealedDmFrame(
  frameCborB64: string,
  myEdSeed: Uint8Array,
): { messageId: string; senderPubkey: string; content: string; ts: number; attachment?: SealedDmAttachment } | null {
  let frame: DmFrame;
  try {
    const bytes = b64ToBytes(frameCborB64);
    frame = dmFrameFromCborMap(decodeCanonical(bytes) as Record<string, unknown>);
  } catch {
    return null;
  }
  try {
    const myX = edPrivateToX25519(myEdSeed);
    const shared = computeSharedSecret(myX, frame.senderEphemeralPub);
    const key = deriveSealedDmKey(shared, frame.inboxHash);
    const plain = openBytes(key, frame.nonce, frame.ciphertext);
    const payload = decodeCanonical(plain) as unknown as SealedDmPayload;
    if (!payload || typeof payload.c !== 'string' || typeof payload.s !== 'string') return null;
    return { messageId: payload.i, senderPubkey: payload.s, content: payload.c, ts: payload.t, attachment: payload.a };
  } catch {
    return null;
  }
}

// ─── base64 helpers ──────────────────────────────────────────────────────────

function bytesToB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return btoa(s);
}

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export { toHex };
