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