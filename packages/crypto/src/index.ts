/**
 * @muster/crypto — public API
 *
 * R14: E2E functions moved to separate entry point '@muster/crypto/e2e'
 * to avoid loading @noble/curves on the relay (ARM compatibility).
 */

export type {
  KeyPair,
  KeystoreEntry,
  EncryptedPayload,
  SignedEnvelope,
  PublicKeyBytes,
  PrivateKeyBytes,
  SignatureBytes,
  SymmetricKeyBytes,
} from './types.js';

export {
  generateKeyPair,
  deriveKeyPair,
  getPublicKey,
  toHex,
  fromHex,
  toBase64,
  fromBase64,
} from './keys.js';

export {
  sign,
  verify,
  createEnvelope,
  openEnvelope,
} from './signing.js';

export {
  PBKDF2_ITERATIONS,
  generateSalt,
  generateIV,
  deriveKeyFromPassword,
  encryptAES,
  decryptAES,
  createKeystoreEntry,
  unlockKeystore,
} from './encryption.js';

// R25 — Phase 1: canonical CBOR + Merkle helpers
export type { CborValue } from './cbor.js';
export { encodeCanonical, decodeCanonical } from './cbor.js';
export {
  PIECE_SIZE,
  MAX_BLOB_SIZE,
  MAX_PIECES,
  ZERO32,
  piecesOf,
  pieceId,
  merkleRoot,
  rootFromLeaves,
  merkleProof,
  verifyPiece,
} from './merkle.js';

// Re-export SHA-256 so consumers don't need to depend on @noble/hashes directly.
export { sha256 } from '@noble/hashes/sha256';