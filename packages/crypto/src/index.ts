/**
 * @muster/crypto — public API
 *
 * Import from this file only. Internal modules are subject to change.
 *
 * @example
 * import { generateKeyPair, createKeystoreEntry, unlockKeystore } from '@muster/crypto';
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
