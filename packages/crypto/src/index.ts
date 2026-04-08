/**
 * @muster/crypto — public API
 *
 * R14: Added E2E encryption exports.
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

export {
  E2E_PREFIX,
  edPrivateToX25519,
  edPublicToX25519,
  computeSharedSecret,
  deriveMessageKey,
  encryptMessage,
  decryptMessage,
  encryptDM,
  decryptDM,
  isE2EEncrypted,
} from './e2e.js';
