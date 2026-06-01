/**
 * blobUpload — generic content-addressed blob upload (R25).
 *
 * Encrypts arbitrary bytes under a fresh AES-256-GCM key, splits the
 * ciphertext into 256-KB pieces, and uploads them (BLOB_ANNOUNCE +
 * PIECE_UPLOAD). Returns the blob descriptor + the raw key so the caller
 * can hand the key to the recipient over an already-E2E channel (e.g. a
 * sealed DM payload). The relay serves pieces by root regardless of
 * community/channel, so any recipient can fetch + decrypt with the key.
 *
 * Channels use lib/envelope.ts (group-key wrapped); DMs use this (raw key
 * carried inside the sealed DM, which is itself E2E to the recipient).
 */

import {
  piecesOf,
  pieceId,
  merkleRoot,
  PIECE_SIZE,
  toHex,
  toBase64,
} from '@muster/crypto';
import { fetchBlobCiphertext, decryptBlobCiphertext, type PieceTransport } from './pieceFetcher';
import type { BlobRef } from '@muster/protocol';

export interface UploadTransport {
  send: (msg: any) => void;
  isConnected: boolean;
}

export interface UploadedBlob {
  rootHex: string;
  size: number;
  mime: string;
  pieceCount: number;
  keyHex: string;
}

async function aesEncrypt(key: Uint8Array, plaintext: Uint8Array): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
  const subtle = (globalThis.crypto ?? window.crypto).subtle;
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ck = await subtle.importKey('raw', key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer }, ck, plaintext.buffer.slice(plaintext.byteOffset, plaintext.byteOffset + plaintext.byteLength) as ArrayBuffer));
  return { nonce, ciphertext: ct };
}

/** Encrypt + chunk + upload bytes. Returns the descriptor + raw key. */
export async function buildAndUploadBlob(
  transport: UploadTransport,
  bytes: Uint8Array,
  mime: string,
): Promise<UploadedBlob> {
  if (!transport.isConnected) throw new Error('blobUpload: transport not connected');
  const key = crypto.getRandomValues(new Uint8Array(32));
  const { nonce, ciphertext } = await aesEncrypt(key, bytes);
  // Prefix the nonce so the receiver can decrypt the contiguous stream.
  const cipherAll = new Uint8Array(nonce.length + ciphertext.length);
  cipherAll.set(nonce, 0);
  cipherAll.set(ciphertext, nonce.length);

  const pieces = piecesOf(cipherAll);
  const root = merkleRoot(pieces);
  const rootHex = toHex(root);

  transport.send({
    type: 'BLOB_ANNOUNCE',
    payload: { root: rootHex, size: cipherAll.length, mime, pieceCount: pieces.length, pieceSize: PIECE_SIZE },
    timestamp: Date.now(),
  });
  for (let i = 0; i < pieces.length; i++) {
    transport.send({
      type: 'PIECE_UPLOAD',
      payload: { blobRoot: rootHex, pieceIdx: i, bytes: toBase64(pieces[i]!) },
      timestamp: Date.now(),
    });
    void pieceId; // pieces are addressed by (root, idx); explicit id not needed here
  }

  return { rootHex, size: cipherAll.length, mime, pieceCount: pieces.length, keyHex: toHex(key) };
}

/** Fetch + decrypt a blob uploaded by buildAndUploadBlob, given its
 *  descriptor + raw key (hex). Returns the plaintext bytes. */
export async function fetchAndDecryptBlob(
  transport: PieceTransport,
  desc: { rootHex: string; size: number; mime: string; pieceCount: number; keyHex: string },
): Promise<Uint8Array> {
  const root = hexToBytes(desc.rootHex);
  const blobRef: BlobRef = {
    root,
    size: desc.size,
    mime: desc.mime,
    pieceCount: desc.pieceCount,
    pieceSize: PIECE_SIZE,
    keyWrap: new Uint8Array(0),
    nonce: new Uint8Array(0),
    epoch: 0,
  };
  const cipherAll = await fetchBlobCiphertext(transport, blobRef, { concurrency: 4 });
  return decryptBlobCiphertext(cipherAll, hexToBytes(desc.keyHex));
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
