/**
 * @muster/crypto/merkle — piece splitting + balanced binary Merkle tree.
 *
 * R25 — Phase 1. Implements the blob content-addressing model from
 * docs/specs/BLOB.md:
 *   - Pieces are 262144 bytes (256 KB). Last piece may be shorter.
 *   - Leaf hash = SHA-256(pieceBytes).
 *   - Internal node hash = SHA-256(left || right).
 *   - Tree padded to 2^n with ZERO32 leaves.
 *   - For a 1-piece blob, root === pieceId (no padding).
 */

import { sha256 } from '@noble/hashes/sha256';

export const PIECE_SIZE = 262144; // 256 KB
export const ZERO32 = new Uint8Array(32);
export const MAX_BLOB_SIZE = 2 * 1024 * 1024 * 1024; // 2 GiB
export const MAX_PIECES = Math.ceil(MAX_BLOB_SIZE / PIECE_SIZE); // 8192

/** Split bytes into pieces of fixed PIECE_SIZE. Last piece may be short. */
export function piecesOf(bytes: Uint8Array): Uint8Array[] {
  if (bytes.length === 0) throw new Error('merkle: blob must have at least 1 byte');
  if (bytes.length > MAX_BLOB_SIZE) throw new Error(`merkle: blob > ${MAX_BLOB_SIZE} bytes`);
  const count = Math.ceil(bytes.length / PIECE_SIZE);
  const out: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * PIECE_SIZE;
    const end = Math.min(start + PIECE_SIZE, bytes.length);
    out.push(bytes.subarray(start, end));
  }
  return out;
}

/** SHA-256 of a single piece — returns the piece ID. */
export function pieceId(piece: Uint8Array): Uint8Array {
  return sha256(piece);
}

/** Compute Merkle root from a list of pieces. Pieces are hashed into leaves then balanced. */
export function merkleRoot(pieces: Uint8Array[]): Uint8Array {
  if (pieces.length === 0) throw new Error('merkle: cannot compute root of 0 pieces');
  if (pieces.length > MAX_PIECES) throw new Error(`merkle: > ${MAX_PIECES} pieces`);
  const leaves = pieces.map(pieceId);
  if (leaves.length === 1) return leaves[0]!;
  return rootFromLeaves(leaves);
}

/**
 * Build a balanced tree from leaves. Pads to the next power of two with
 * ZERO32 leaves. Returns the root.
 */
export function rootFromLeaves(leaves: Uint8Array[]): Uint8Array {
  if (leaves.length === 0) throw new Error('merkle: no leaves');
  const targetLen = nextPow2(leaves.length);
  const padded = leaves.slice();
  while (padded.length < targetLen) padded.push(ZERO32);
  let level = padded;
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(hash2(level[i]!, level[i + 1]!));
    }
    level = next;
  }
  return level[0]!;
}

/**
 * Produce the sibling-hash proof path for a piece at `index` in a tree of
 * `totalPieces` leaves. Returned list is ordered leaf→root (first element
 * is the leaf's sibling, last is the root's child's sibling).
 */
export function merkleProof(leaves: Uint8Array[], index: number): Uint8Array[] {
  if (index < 0 || index >= leaves.length) throw new Error('merkle: index out of range');
  const targetLen = nextPow2(leaves.length);
  const level: Uint8Array[] = leaves.slice();
  while (level.length < targetLen) level.push(ZERO32);

  const proof: Uint8Array[] = [];
  let idx = index;
  let cur = level;
  while (cur.length > 1) {
    const siblingIdx = idx ^ 1;
    proof.push(cur[siblingIdx]!);
    const next: Uint8Array[] = [];
    for (let i = 0; i < cur.length; i += 2) {
      next.push(hash2(cur[i]!, cur[i + 1]!));
    }
    cur = next;
    idx = idx >> 1;
  }
  return proof;
}

/**
 * Verify that `pieceBytes` at `index` belongs to the blob whose root is
 * `expectedRoot`, using `proof` (siblings, leaf→root order).
 * `totalPieces` is required to derive the tree height.
 */
export function verifyPiece(
  pieceBytes: Uint8Array,
  index: number,
  totalPieces: number,
  proof: Uint8Array[],
  expectedRoot: Uint8Array,
): boolean {
  if (totalPieces < 1) return false;
  if (index < 0 || index >= totalPieces) return false;
  const targetLen = nextPow2(totalPieces);
  const expectedProofLen = Math.log2(targetLen);
  // single-piece blob: root === pieceId, empty proof
  if (totalPieces === 1) {
    return proof.length === 0 && bytesEqual(pieceId(pieceBytes), expectedRoot);
  }
  if (proof.length !== expectedProofLen) return false;
  let hash = pieceId(pieceBytes);
  let idx = index;
  for (const sibling of proof) {
    hash = (idx & 1) === 0 ? hash2(hash, sibling) : hash2(sibling, hash);
    idx = idx >> 1;
  }
  return bytesEqual(hash, expectedRoot);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function hash2(a: Uint8Array, b: Uint8Array): Uint8Array {
  const buf = new Uint8Array(a.length + b.length);
  buf.set(a, 0);
  buf.set(b, a.length);
  return sha256(buf);
}

function nextPow2(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
