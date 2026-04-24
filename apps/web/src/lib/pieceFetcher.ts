/**
 * pieceFetcher — R25 / Phase 4.
 *
 * Browser-side fetcher for blob pieces. Given a BlobRef + wrapped blob key
 * (from an envelope's BlobBody), it:
 *   1. Requests each piece from the relay with a Merkle proof.
 *   2. Verifies the proof against `blobRef.root`.
 *   3. Concatenates verified pieces into the blob ciphertext stream.
 *   4. Splits off the leading 12-byte GCM nonce and decrypts with the
 *      blob key (provided by the caller — typically from
 *      groupCryptoStore unwrap).
 *
 * Design notes:
 *   - Pure functions + a tiny request-coordinator. No Zustand. Callers
 *     (pieceCacheStore, voice-note renderer) compose this with their
 *     own cache + UI layer.
 *   - Uses the TransportMessage event stream — we attach a one-shot
 *     listener per request and resolve on matching (blobRoot, pieceIdx)
 *     PIECE_RESPONSE.
 *   - Parallelism: up to `CONCURRENCY` pieces in flight. Pieces are
 *     256 KB so even a ~5 MB blob streams in 20 round-trips batched.
 *
 * Gated behind VITE_TWO_LAYER=1 in consumer code.
 */

import {
  verifyPiece,
  toHex,
  fromBase64,
} from '@muster/crypto';
import type { TransportMessage } from '@muster/transport';
import type { BlobRef } from '@muster/protocol';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PieceTransport {
  send: (msg: any) => void;
  isConnected: boolean;
  /**
   * Subscribe to every incoming TransportMessage. Returns an unsubscribe
   * function. Matches `useNetworkStore.onMessage` signature so callers
   * can pass it in directly.
   */
  onMessage: (handler: (msg: TransportMessage) => void) => () => void;
}

export interface FetchPiecesOptions {
  /** Max concurrent in-flight PIECE_REQUEST messages. */
  concurrency?: number;
  /** Per-piece timeout. Defaults to 15 s. */
  pieceTimeoutMs?: number;
  /** Optional hook for progress reporting. */
  onProgress?: (done: number, total: number) => void;
  /**
   * Piece-level cache. If provided, fetcher checks the cache before
   * going to the network and populates it on every verified fetch.
   */
  cache?: PieceByteCache;
}

export interface PieceByteCache {
  /** Lookup by (blobRoot, pieceIdx). Returns null on miss. */
  getByIndex: (blobRoot: Uint8Array, pieceIdx: number) => Promise<Uint8Array | null> | Uint8Array | null;
  /** Store a verified piece and record its (blobRoot, idx → pieceId) link. */
  put: (blobRoot: Uint8Array, pieceIdx: number, pieceId: Uint8Array, bytes: Uint8Array) => Promise<void> | void;
}

/**
 * Fetch every piece of a blob and return the verified, ordered ciphertext
 * stream (concat of piece bytes, leading 12 B GCM nonce included).
 *
 * Throws on:
 *   - timeout
 *   - bad Merkle proof
 *   - relay `notHave` for any piece
 */
export async function fetchBlobCiphertext(
  transport: PieceTransport,
  blobRef: BlobRef,
  opts: FetchPiecesOptions = {},
): Promise<Uint8Array> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const timeoutMs = opts.pieceTimeoutMs ?? 15_000;
  const total = blobRef.pieceCount;
  if (total <= 0) throw new Error('pieceFetcher: pieceCount must be > 0');

  const rootHex = toHex(blobRef.root);
  const buffers = new Array<Uint8Array>(total);
  let done = 0;

  // Channel matcher: one listener for the whole batch. Keyed by pieceIdx
  // because pieceId is not known client-side when we requested by idx.
  const waiters = new Map<number, {
    resolve: (bytes: Uint8Array) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  const unsubscribe = transport.onMessage((msg: any) => {
    if (msg?.type !== 'PIECE_RESPONSE') return;
    const p = msg.payload ?? {};
    if (typeof p.blobRoot !== 'string' || p.blobRoot.toLowerCase() !== rootHex.toLowerCase()) return;
    const idx: number | undefined = typeof p.pieceIdx === 'number' ? p.pieceIdx : undefined;
    if (idx === undefined) return;
    const waiter = waiters.get(idx);
    if (!waiter) return;

    if (p.notHave) {
      clearTimeout(waiter.timer);
      waiters.delete(idx);
      waiter.reject(new Error(`pieceFetcher: relay does not have piece ${idx} of ${rootHex.slice(0, 12)}…`));
      return;
    }

    try {
      const bytes = fromBase64(p.bytes);
      const proof: Uint8Array[] = Array.isArray(p.proof)
        ? p.proof.map((b: string) => fromBase64(b))
        : [];
      const ok = verifyPiece(bytes, idx, p.totalPieces ?? total, proof, blobRef.root);
      if (!ok) {
        throw new Error(`pieceFetcher: merkle proof failed for piece ${idx}`);
      }
      clearTimeout(waiter.timer);
      waiters.delete(idx);
      waiter.resolve(bytes);
    } catch (err) {
      clearTimeout(waiter.timer);
      waiters.delete(idx);
      waiter.reject(err as Error);
    }
  });

  const requestPiece = (idx: number): Promise<Uint8Array> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(idx);
      reject(new Error(`pieceFetcher: piece ${idx} timed out`));
    }, timeoutMs);
    waiters.set(idx, { resolve, reject, timer });

    transport.send({
      type: 'PIECE_REQUEST',
      payload: {
        blobRoot: rootHex,
        pieceIdx: idx,
        withProof: true,
      },
      timestamp: Date.now(),
    });
  });

  try {
    // Pump with a bounded semaphore.
    let next = 0;
    const workers: Promise<void>[] = [];
    for (let w = 0; w < Math.min(concurrency, total); w++) {
      workers.push((async () => {
        while (true) {
          const idx = next++;
          if (idx >= total) return;
          // Cache fast-path: ask by (blobRoot, idx). A hit was previously
          // verified against the Merkle root before being stored, so we
          // skip re-verification. Cache misses fall through to network.
          let bytes: Uint8Array | null = null;
          if (opts.cache) {
            try { bytes = await opts.cache.getByIndex(blobRef.root, idx); }
            catch { bytes = null; }
          }
          if (!bytes) bytes = await requestPiece(idx);
          buffers[idx] = bytes;
          if (opts.cache) {
            try {
              const pid = await sha256(bytes);
              await opts.cache.put(blobRef.root, idx, pid, bytes);
            } catch { /* cache is best-effort */ }
          }
          done += 1;
          opts.onProgress?.(done, total);
        }
      })());
    }
    await Promise.all(workers);
  } finally {
    unsubscribe();
    // Cancel any stragglers.
    for (const { timer, reject } of waiters.values()) {
      clearTimeout(timer);
      reject(new Error('pieceFetcher: aborted'));
    }
    waiters.clear();
  }

  // Concat verified pieces in order.
  let totalBytes = 0;
  for (const b of buffers) totalBytes += b.length;
  const out = new Uint8Array(totalBytes);
  let off = 0;
  for (const b of buffers) { out.set(b, off); off += b.length; }
  return out;
}

/**
 * Decrypt the ciphertext stream produced by `fetchBlobCiphertext` using
 * the unwrapped blob key. The stream's first 12 bytes are the GCM nonce
 * (prefixed by the builder — see apps/web/src/lib/envelope.ts).
 */
export async function decryptBlobCiphertext(
  cipherAll: Uint8Array,
  blobKey: Uint8Array,
): Promise<Uint8Array> {
  if (cipherAll.length < 12 + 16) {
    throw new Error('pieceFetcher: ciphertext too short (missing nonce+tag)');
  }
  const nonce = cipherAll.slice(0, 12);
  const body = cipherAll.slice(12);
  const subtle = (globalThis.crypto ?? window.crypto).subtle;
  const cryptoKey = await subtle.importKey(
    'raw',
    blobKey.buffer.slice(blobKey.byteOffset, blobKey.byteOffset + blobKey.byteLength) as ArrayBuffer,
    'AES-GCM',
    false,
    ['decrypt'],
  );
  const pt = new Uint8Array(
    await subtle.decrypt(
      { name: 'AES-GCM', iv: nonce.buffer.slice(nonce.byteOffset, nonce.byteOffset + nonce.byteLength) as ArrayBuffer },
      cryptoKey,
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    ),
  );
  return pt;
}

/**
 * One-shot: fetch + decrypt a whole blob. `unwrapBlobKey` turns the
 * BlobRef's `{ keyWrap, nonce, epoch }` into the raw 32-byte blob key
 * — wire this to `groupCryptoStore.unwrapBlobKey` or equivalent.
 */
export async function fetchBlob(
  transport: PieceTransport,
  blobRef: BlobRef,
  unwrapBlobKey: (wrap: Uint8Array, nonce: Uint8Array, epoch: number) => Promise<Uint8Array>,
  opts: FetchPiecesOptions = {},
): Promise<Uint8Array> {
  const cipherAll = await fetchBlobCiphertext(transport, blobRef, opts);
  const blobKey = await unwrapBlobKey(blobRef.keyWrap, blobRef.nonce, blobRef.epoch);
  return decryptBlobCiphertext(cipherAll, blobKey);
}

// ─── Internal ───────────────────────────────────────────────────────────────

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const subtle = (globalThis.crypto ?? window.crypto).subtle;
  const h = await subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return new Uint8Array(h);
}
