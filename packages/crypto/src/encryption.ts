/**
 * @muster/crypto — AES-256-GCM encryption and PBKDF2 key derivation
 *
 * Used for:
 *   1. Encrypting the user's Ed25519 private key before storing it locally
 *      (the password is never stored — only the derived key is used transiently)
 *   2. Encrypting message payloads for E2E encrypted channels and DMs
 */

import { gcm } from '@noble/ciphers/aes';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';
import type {
  SymmetricKeyBytes,
  IVBytes,
  EncryptedPayload,
  KeystoreEntry,
  KeyPair,
} from './types.js';
import { toHex, toBase64, fromBase64 } from './keys.js';

/** PBKDF2 iteration count — high enough to be slow for attackers */
export const PBKDF2_ITERATIONS = 210_000;

/** AES-256-GCM key length in bytes */
const KEY_BYTES = 32;

/** AES-GCM IV length in bytes (96-bit recommended) */
const IV_BYTES = 12;

/** PBKDF2 salt length in bytes */
const SALT_BYTES = 32;

/**
 * Derive a 256-bit AES key from a user password using PBKDF2-SHA256.
 *
 * The salt must be random and stored alongside the encrypted data.
 * The same password + same salt always produces the same key.
 *
 * @param password   - User's plaintext password (UTF-8 string)
 * @param salt       - 32 random bytes (generate once, store permanently)
 * @param iterations - PBKDF2 round count (default: PBKDF2_ITERATIONS)
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
): Promise<SymmetricKeyBytes> {
  const passwordBytes = new TextEncoder().encode(password);
  return pbkdf2Async(sha256, passwordBytes, salt, {
    c: iterations,
    dkLen: KEY_BYTES,
  });
}

/**
 * Generate a cryptographically random salt for PBKDF2.
 * Call this once during account creation and store the result.
 */
export function generateSalt(): Uint8Array {
  return randomBytes(SALT_BYTES);
}

/**
 * Generate a cryptographically random IV for AES-GCM.
 * A new IV must be generated for every encryption operation.
 */
export function generateIV(): IVBytes {
  return randomBytes(IV_BYTES);
}

/**
 * Encrypt arbitrary bytes with AES-256-GCM.
 *
 * @param plaintext - The data to encrypt
 * @param key       - 32-byte AES key
 * @returns An EncryptedPayload with base64-encoded ciphertext and IV
 */
export function encryptAES(
  plaintext: Uint8Array,
  key: SymmetricKeyBytes,
): EncryptedPayload {
  const iv = generateIV();
  const cipher = gcm(key, iv);
  const ciphertext = cipher.encrypt(plaintext);
  return {
    ciphertext: toBase64(ciphertext),
    iv: toBase64(iv),
  };
}

/**
 * Decrypt AES-256-GCM ciphertext.
 *
 * @param payload - The encrypted payload (ciphertext + IV)
 * @param key     - 32-byte AES key (must match encryption key)
 * @returns Decrypted plaintext bytes
 * @throws {Error} If decryption fails (wrong key or tampered data)
 */
export function decryptAES(
  payload: EncryptedPayload,
  key: SymmetricKeyBytes,
): Uint8Array {
  const iv         = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.ciphertext);
  const cipher     = gcm(key, iv);
  return cipher.decrypt(ciphertext);
}

/**
 * Create a keystore entry — encrypts the private key with the user's password.
 *
 * This is called once during account creation and the result is saved to
 * IndexedDB (browser) or the filesystem (desktop/node).
 *
 * @param keypair    - The user's Ed25519 keypair
 * @param username   - The chosen username
 * @param password   - The user's plaintext password (only used here, not stored)
 */
export async function createKeystoreEntry(
  keypair: KeyPair,
  username: string,
  password: string,
): Promise<KeystoreEntry> {
  const salt = generateSalt();
  const derivedKey = await deriveKeyFromPassword(password, salt, PBKDF2_ITERATIONS);
  const encrypted = encryptAES(keypair.privateKey, derivedKey);

  return {
    username,
    publicKeyHex:       toHex(keypair.publicKey),
    encryptedPrivateKey: encrypted.ciphertext,
    iv:                  encrypted.iv,
    salt:                toBase64(salt),
    pbkdf2Iterations:    PBKDF2_ITERATIONS,
    version:             1,
    createdAt:           new Date().toISOString(),
  };
}

/**
 * Unlock a keystore entry with the user's password.
 *
 * Derives the AES key from the password and decrypts the stored private key.
 * Returns the raw private key bytes — keep these in memory only, never re-persist.
 *
 * @param entry    - The keystore entry loaded from storage
 * @param password - The user's plaintext password
 * @returns Decrypted 32-byte private key
 * @throws {Error} If the password is wrong or the keystore is corrupted
 */
export async function unlockKeystore(
  entry: KeystoreEntry,
  password: string,
): Promise<Uint8Array> {
  const salt = fromBase64(entry.salt);
  const derivedKey = await deriveKeyFromPassword(
    password,
    salt,
    entry.pbkdf2Iterations,
  );

  try {
    return decryptAES(
      { ciphertext: entry.encryptedPrivateKey, iv: entry.iv },
      derivedKey,
    );
  } catch {
    // AES-GCM auth tag failure means wrong password or corrupted data
    throw new Error('Invalid password or corrupted keystore');
  }
}
