/**
 * PosManager — R25 / Phase 7.
 *
 * Issues and responds to Proof-of-Storage challenges (POS.md). Bridges
 * peerManager (string nodeIds, JSON over WS) and the canonical-CBOR
 * POS_CHALLENGE / POS_RESPONSE wire format.
 *
 * Wire framing: { type:'POS', payload:{ cbor: base64(canonicalCBOR(PosMessage)) } }
 *
 * Phase-7 MVP scope:
 *   - Targets supported: 'piece' and 'chunk' (both stored in blobDB).
 *     'op' challenges are accepted on the wire but we never issue them
 *     and respond with a digest that won't match (responder treats as
 *     not-stored). Op-level POS lands when the op codec round-trips
 *     canonically through opLogDB (Phase 7 follow-up).
 *   - Challenge sig is 64 zero bytes (peer link already authenticated).
 *   - Window: 5 KB + up to 1 KB random jitter, clamped to target size.
 */

import { encodeCanonical, decodeCanonical, sha256, type CborValue } from '@muster/crypto';
import {
  POS_DIGEST_BYTES,
  POS_MAX_CHALLENGES_PER_HOUR,
  POS_NONCE_BYTES,
  POS_RESPONSE_TIMEOUT_MS,
  POS_SIG_BYTES,
  POS_WINDOW_BASE,
  POS_WINDOW_JITTER_MAX,
  posMessageFromCborMap,
  posMessageToCborMap,
  type PosChallenge,
  type PosMessage,
  type PosResponse,
  type PosTargetKind,
} from '@muster/protocol';
import { randomBytes } from 'crypto';
import type { PeerManager } from './peerManager';
import type { BlobDB } from './blobDB';
import type { ReputationManager } from './reputation';

interface PendingChallenge {
  nonceHex: string;
  peerId: string;
  expectedDigest: Uint8Array;
  timer: ReturnType<typeof setTimeout>;
  resolve: (outcome: 'pass' | 'fail' | 'timeout') => void;
}

interface RateBucket {
  /** Sorted ms timestamps of issued challenges within the trailing hour. */
  ts: number[];
}

const HOUR_MS = 60 * 60 * 1000;

export class PosManager {
  private peerManager: PeerManager;
  private blobDB: BlobDB;
  private reputation: ReputationManager;

  /** nonceHex → pending. */
  private pending = new Map<string, PendingChallenge>();
  /** peerId → rate bucket. */
  private rate = new Map<string, RateBucket>();

  constructor(peerManager: PeerManager, blobDB: BlobDB, reputation: ReputationManager) {
    this.peerManager = peerManager;
    this.blobDB = blobDB;
    this.reputation = reputation;
  }

  start(): void {
    this.peerManager.setPosHooks({
      onMessage: (peerId, msg) => this.handleIncoming(peerId, msg),
      onDisconnect: (peerId) => this.dropPending(peerId),
    });
    console.log('[pos] manager started');
  }

  // ── Inbound ─────────────────────────────────────────────────────────────

  private handleIncoming(peerId: string, frame: { type: string; payload?: { cbor?: string } }): void {
    const cborB64 = frame.payload?.cbor;
    if (typeof cborB64 !== 'string') return;
    let parsed: PosMessage;
    try {
      const bytes = new Uint8Array(Buffer.from(cborB64, 'base64'));
      parsed = posMessageFromCborMap(decodeCanonical(bytes) as Record<string, unknown>);
    } catch (err) {
      console.warn('[pos] bad inbound from', peerId, ':', (err as Error).message);
      return;
    }
    if (parsed.kind === 'POS_CHALLENGE') void this.respondTo(peerId, parsed);
    else this.matchResponse(peerId, parsed);
  }

  private async respondTo(peerId: string, ch: PosChallenge): Promise<void> {
    if (this.reputation.isBlacklisted(peerId)) return;
    const content = this.loadContent(ch.targetKind, ch.target);
    let digest: Uint8Array;
    if (!content) {
      // Respond with a digest derived from a zero buffer — guaranteed to
      // mismatch. Tells the issuer we don't have the content.
      digest = computeDigest(ch.target, ch.offsetStart, ch.offsetEnd, ch.nonce, new Uint8Array(0));
    } else {
      const slice = sliceClamped(content, ch.offsetStart, ch.offsetEnd);
      digest = computeDigest(ch.target, ch.offsetStart, ch.offsetEnd, ch.nonce, slice);
    }
    const resp: PosResponse = { kind: 'POS_RESPONSE', nonce: ch.nonce, digest };
    this.sendPos(peerId, resp);
  }

  private matchResponse(peerId: string, resp: PosResponse): void {
    const nonceHex = bytesHex(resp.nonce);
    const p = this.pending.get(nonceHex);
    if (!p) return;
    if (p.peerId !== peerId) return; // Wrong sender — ignore.
    this.pending.delete(nonceHex);
    clearTimeout(p.timer);
    if (eqBytes(resp.digest, p.expectedDigest)) p.resolve('pass');
    else p.resolve('fail');
  }

  private dropPending(peerId: string): void {
    for (const [nonceHex, p] of this.pending) {
      if (p.peerId !== peerId) continue;
      clearTimeout(p.timer);
      this.pending.delete(nonceHex);
      // Treat as a timeout for accounting.
      try { p.resolve('timeout'); } catch { /* ignore */ }
    }
  }

  // ── Issue ───────────────────────────────────────────────────────────────

  /**
   * Send a challenge to `peerId` for the given content. The issuer MUST
   * hold the content locally (we recompute the expected digest here).
   * Returns the outcome and adjusts reputation accordingly.
   *
   * Returns `null` when the challenge could not be issued (rate-limited,
   * unknown target locally, or no live connection).
   */
  async challenge(peerId: string, targetKind: PosTargetKind, target: Uint8Array): Promise<'pass' | 'fail' | 'timeout' | null> {
    if (this.reputation.isBlacklisted(peerId)) return null;
    if (!this.consumeRate(peerId)) return null;

    const content = this.loadContent(targetKind, target);
    if (!content || content.length === 0) return null;

    const window = pickWindow(content.length);
    const nonce = new Uint8Array(randomBytes(POS_NONCE_BYTES));
    const slice = content.subarray(window.start, window.end);
    const expected = computeDigest(target, window.start, window.end, nonce, slice);

    const ch: PosChallenge = {
      kind: 'POS_CHALLENGE',
      nonce,
      target,
      targetKind,
      offsetStart: window.start,
      offsetEnd: window.end,
      ts: Date.now(),
      sig: new Uint8Array(POS_SIG_BYTES), // MVP — peer link already authenticated.
    };

    this.reputation.noteChallengeIssued();

    const outcome = await new Promise<'pass' | 'fail' | 'timeout'>((resolve) => {
      const nonceHex = bytesHex(nonce);
      const timer = setTimeout(() => {
        this.pending.delete(nonceHex);
        resolve('timeout');
      }, POS_RESPONSE_TIMEOUT_MS);
      this.pending.set(nonceHex, {
        nonceHex,
        peerId,
        expectedDigest: expected,
        timer,
        resolve,
      });
      const ok = this.sendPos(peerId, ch);
      if (!ok) {
        clearTimeout(timer);
        this.pending.delete(nonceHex);
        resolve('timeout');
      }
    });

    switch (outcome) {
      case 'pass':    this.reputation.noteChallengePassed(); this.reputation.applyEvent(peerId, 'POS_OK'); break;
      case 'fail':    this.reputation.noteChallengeFailed(); this.reputation.applyEvent(peerId, 'POS_BAD'); break;
      case 'timeout': this.reputation.noteChallengeTimedOut(); this.reputation.applyEvent(peerId, 'POS_TIMEOUT'); break;
    }
    return outcome;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private loadContent(kind: PosTargetKind, id: Uint8Array): Uint8Array | null {
    if (kind === 'piece' || kind === 'chunk') {
      const piece = this.blobDB.getPiece(Buffer.from(id));
      if (!piece) return null;
      // better-sqlite3 returns Buffer for BLOB columns.
      return new Uint8Array(piece.bytes);
    }
    // 'op' targets not supported in this MVP — see file header.
    return null;
  }

  private sendPos(peerId: string, msg: PosMessage): boolean {
    const map = posMessageToCborMap(msg);
    const bytes = encodeCanonical(map as CborValue);
    const cbor = Buffer.from(bytes).toString('base64');
    return this.peerManager.sendToPeer(peerId, {
      type: 'POS',
      payload: { cbor },
      timestamp: Date.now(),
    });
  }

  private consumeRate(peerId: string): boolean {
    const now = Date.now();
    let bucket = this.rate.get(peerId);
    if (!bucket) {
      bucket = { ts: [] };
      this.rate.set(peerId, bucket);
    }
    // Drop entries older than the trailing hour.
    while (bucket.ts.length > 0 && (bucket.ts[0] ?? 0) < now - HOUR_MS) bucket.ts.shift();
    if (bucket.ts.length >= POS_MAX_CHALLENGES_PER_HOUR) return false;
    bucket.ts.push(now);
    return true;
  }
}

// ─── Pure helpers ──────────────────────────────────────────────────────────

/**
 * Per POS.md §Response digest:
 *   SHA-256(target || u32_be(offsetStart) || u32_be(offsetEnd)
 *           || nonce || content[offsetStart..offsetEnd])
 */
export function computeDigest(
  target: Uint8Array,
  offsetStart: number,
  offsetEnd: number,
  nonce: Uint8Array,
  contentSlice: Uint8Array,
): Uint8Array {
  const start = u32be(offsetStart);
  const end = u32be(offsetEnd);
  const total = target.length + 4 + 4 + nonce.length + contentSlice.length;
  const buf = new Uint8Array(total);
  let off = 0;
  buf.set(target, off);              off += target.length;
  buf.set(start, off);               off += 4;
  buf.set(end, off);                 off += 4;
  buf.set(nonce, off);               off += nonce.length;
  buf.set(contentSlice, off);        off += contentSlice.length;
  const h = sha256(buf);
  if (h.length !== POS_DIGEST_BYTES) throw new Error('pos: digest length unexpected');
  return h;
}

/** Pick a 5–6 KB window inside a content of `size` bytes. Clamped if
 *  the content is shorter than the window. */
export function pickWindow(size: number): { start: number; end: number } {
  const jitter = Math.floor(Math.random() * (POS_WINDOW_JITTER_MAX + 1));
  const requested = POS_WINDOW_BASE + jitter;
  const window = Math.min(requested, size);
  if (window <= 0) return { start: 0, end: 0 };
  if (window === size) return { start: 0, end: size };
  const maxStart = size - window;
  const start = Math.floor(Math.random() * (maxStart + 1));
  return { start, end: start + window };
}

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = (n >>> 24) & 0xff;
  b[1] = (n >>> 16) & 0xff;
  b[2] = (n >>> 8) & 0xff;
  b[3] = n & 0xff;
  return b;
}

function sliceClamped(content: Uint8Array, start: number, end: number): Uint8Array {
  const s = Math.max(0, Math.min(start, content.length));
  const e = Math.max(s, Math.min(end, content.length));
  return content.subarray(s, e);
}

function bytesHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += (b[i]! < 16 ? '0' : '') + b[i]!.toString(16);
  return s;
}

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
