/**
 * pieceCacheStore — R25 / Phase 4.
 *
 * Browser-side piece cache with the same 90/10 hosted/cache split used
 * by the relay `PieceEvictor`:
 *   - Pieces that belong to a blob whose envelope references a HOSTED
 *     community are pinned (never evicted by this store).
 *   - Everything else is cache; LRU-evicted when total usage passes
 *     the configured soft cap.
 *
 * Backed by Dexie (`BrowserDB.pieces` + `.blobs` + `.blobPieces`).
 *
 * This store is a thin coordination layer; `pieceFetcher` writes raw
 * piece bytes via `put(pieceId, bytes)` and `get(pieceId)` reads them
 * back. The eviction sweep runs periodically and on-demand.
 *
 * Gated behind VITE_TWO_LAYER=1 in consumer code.
 */

import { create } from 'zustand';
import { BrowserDB } from '@muster/db';
import { toHex, fromHex } from '@muster/crypto';

// ─── Config ─────────────────────────────────────────────────────────────────

/** Default soft cap on piece byte usage (500 MB in the browser). */
export const DEFAULT_CACHE_MAX_BYTES = 500 * 1024 * 1024;

/** Hosted share — matches relay policy. */
export const HOSTED_SHARE = 0.9;

/** How often the sweep runs (ms). */
export const CACHE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PieceCacheStats {
  totalBytes: number;
  pinnedBytes: number;
  cacheBytes: number;
  pieceCount: number;
  pinnedCap: number;
  cacheCap: number;
}

interface PieceCacheState {
  db: BrowserDB | null;
  maxBytes: number;
  /** User-supplied predicate: given a blob root (hex) → is any envelope
   *  referencing it attached to a hosted community? */
  isBlobPinned: (blobRootHex: string) => boolean;
  /** Timer handle for the periodic sweep. */
  _sweepTimer: ReturnType<typeof setInterval> | null;

  // ── Lifecycle ────────────────────────────────────────────────────────────
  init: (opts?: {
    db?: BrowserDB;
    maxBytes?: number;
    isBlobPinned?: (blobRootHex: string) => boolean;
  }) => void;
  shutdown: () => void;

  // ── PieceByteCache surface (matches pieceFetcher.PieceByteCache) ────────
  getByIndex: (blobRoot: Uint8Array, pieceIdx: number) => Promise<Uint8Array | null>;
  put: (blobRoot: Uint8Array, pieceIdx: number, pieceId: Uint8Array, bytes: Uint8Array) => Promise<void>;

  stats: () => Promise<PieceCacheStats>;
  sweep: () => Promise<number>;
  clear: () => Promise<void>;
}

export const usePieceCacheStore = create<PieceCacheState>((set, get) => ({
  db: null,
  maxBytes: DEFAULT_CACHE_MAX_BYTES,
  isBlobPinned: () => false,
  _sweepTimer: null,

  init: (opts) => {
    const st = get();
    if (st.db) return;
    const db = opts?.db ?? new BrowserDB();
    const maxBytes = opts?.maxBytes ?? DEFAULT_CACHE_MAX_BYTES;
    const isBlobPinned = opts?.isBlobPinned ?? (() => false);
    const timer = setInterval(() => {
      void get().sweep().catch((err) => console.warn('[pieceCache] sweep failed:', err));
    }, CACHE_SWEEP_INTERVAL_MS);
    set({ db, maxBytes, isBlobPinned, _sweepTimer: timer });
  },

  shutdown: () => {
    const { _sweepTimer } = get();
    if (_sweepTimer) clearInterval(_sweepTimer);
    set({ _sweepTimer: null });
  },

  // ─── Piece byte surface ────────────────────────────────────────────────

  getByIndex: async (blobRoot, pieceIdx) => {
    const { db } = get();
    if (!db) return null;
    const rootHex = toHex(blobRoot);
    const links = await db.blobPieces.where('key').equals(`${rootHex}:${pieceIdx}`).toArray();
    const link = links[0];
    if (!link) return null;
    const p = await db.getPiece(link.pieceId);
    if (!p) return null;
    return p.bytes instanceof Uint8Array ? p.bytes : new Uint8Array(p.bytes);
  },

  put: async (blobRoot, pieceIdx, pieceId, bytes) => {
    const { db } = get();
    if (!db) return;
    const pidHex = toHex(pieceId);
    const rootHex = toHex(blobRoot);
    await db.putPiece({
      pieceId: pidHex,
      bytes,
      size: bytes.length,
      lastAccessedAt: Date.now(),
    });
    await db.linkBlobPiece(rootHex, pieceIdx, pidHex);
  },

  // ─── Stats / eviction ───────────────────────────────────────────────────

  stats: async () => {
    const { db, maxBytes, isBlobPinned } = get();
    if (!db) {
      return {
        totalBytes: 0, pinnedBytes: 0, cacheBytes: 0, pieceCount: 0,
        pinnedCap: Math.floor(maxBytes * HOSTED_SHARE),
        cacheCap: Math.floor(maxBytes * (1 - HOSTED_SHARE)),
      };
    }

    // Build set of pinned pieceIds by walking hosted blobs.
    const hostedRoots: string[] = [];
    const allBlobs = await db.blobs.toArray();
    for (const b of allBlobs) {
      if (isBlobPinned(b.root)) hostedRoots.push(b.root);
    }
    const pinnedIds = new Set<string>();
    for (const root of hostedRoots) {
      const links = await db.getBlobPieces(root);
      for (const l of links) pinnedIds.add(l.pieceId);
    }

    let totalBytes = 0;
    let pinnedBytes = 0;
    let count = 0;
    await db.pieces.each((p) => {
      totalBytes += p.size;
      count += 1;
      if (pinnedIds.has(p.pieceId)) pinnedBytes += p.size;
    });

    return {
      totalBytes,
      pinnedBytes,
      cacheBytes: totalBytes - pinnedBytes,
      pieceCount: count,
      pinnedCap: Math.floor(maxBytes * HOSTED_SHARE),
      cacheCap: Math.floor(maxBytes * (1 - HOSTED_SHARE)),
    };
  },

  sweep: async () => {
    const { db, maxBytes, isBlobPinned } = get();
    if (!db) return 0;

    const s = await get().stats();
    if (s.totalBytes <= maxBytes) return 0;

    let toFree = 0;
    if (s.cacheBytes > s.cacheCap) toFree = s.cacheBytes - s.cacheCap;
    else toFree = s.cacheBytes; // pinned+cache blow cap → drop cache, keep pinned

    if (toFree <= 0) return 0;

    // Build pinned set once.
    const hostedRoots: string[] = [];
    const allBlobs = await db.blobs.toArray();
    for (const b of allBlobs) {
      if (isBlobPinned(b.root)) hostedRoots.push(b.root);
    }
    const pinnedIds = new Set<string>();
    for (const root of hostedRoots) {
      const links = await db.getBlobPieces(root);
      for (const l of links) pinnedIds.add(l.pieceId);
    }

    // LRU candidates = all non-pinned pieces, oldest first.
    const victims = await db.pieces.orderBy('lastAccessedAt').toArray();
    let freed = 0;
    for (const v of victims) {
      if (freed >= toFree) break;
      if (pinnedIds.has(v.pieceId)) continue;
      await db.pieces.delete(v.pieceId);
      freed += v.size;
    }
    if (freed > 0) {
      console.log(`[pieceCache] freed ${(freed / 1024 / 1024).toFixed(1)} MB (${victims.length} candidates)`);
    }
    return freed;
  },

  clear: async () => {
    const { db } = get();
    if (!db) return;
    await db.pieces.clear();
    await db.blobPieces.clear();
    await db.blobs.clear();
  },
}));

// Re-export for convenience.
export { fromHex, toHex };
