/**
 * @muster/crypto — End-to-End Encryption (R14)
 *
 * Provides E2E encrypted messaging for DMs:
 * 1. Convert Ed25519 keys → X25519 for ECDH
 * 2. ECDH shared secret between two users
 * 3. HKDF-SHA256 to derive AES-256-GCM message key
 * 4. Encrypt/decrypt messages with AES-256-GCM
 *
 * The relay only sees ciphertext — zero-knowledge.
 */

import { x25519 } from '@noble/curves/ed25519';
import { edwardsToMontgomeryPriv, edwardsToMontgomeryPub } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { gcm } from '@noble/ciphers/aes';
import { randomBytes } from '@noble/hashes/utils';

/** AES-GCM IV length (96-bit recommended). */
const IV_BYTES = 12;

/** HKDF info string for deriving message keys. */
const HKDF_INFO = new TextEncoder().encode('muster-e2e-dm-v1');

/** Prefix for encrypted message content. */
export const E2E_PREFIX = '__E2E__';

// =================================================================
// Key conversion: Ed25519 → X25519
// =================================================================

/**
 * Convert an Ed25519 private key to an X25519 private key.
 * Required for ECDH key exchange (Diffie-Hellman uses Curve25519/X25519).
 */
export function edPrivateToX25519(edPrivateKey: Uint8Array): Uint8Array {
  return edwardsToMontgomeryPriv(edPrivateKey);
}

/**
 * Convert an Ed25519 public key to an X25519 public key.
 */
export function edPublicToX25519(edPublicKey: Uint8Array): Uint8Array {
  return edwardsToMontgomeryPub(edPublicKey);
}

// =================================================================
// ECDH + Key Derivation
// =================================================================

/**
 * Compute an ECDH shared secret between two users.
 *
 * @param myX25519Private - The current user's X25519 private key
 * @param theirX25519Public - The other user's X25519 public key
 * @returns 32-byte shared secret
 */
export function computeSharedSecret(
  myX25519Private: Uint8Array,
  theirX25519Public: Uint8Array,
): Uint8Array {
  return x25519.scalarMult(myX25519Private, theirX25519Public);
}

/**
 * Derive a symmetric AES-256-GCM key from an ECDH shared secret using HKDF-SHA256.
 *
 * The same shared secret always produces the same key — both parties
 * compute the same key independently.
 *
 * @param sharedSecret - 32-byte ECDH shared secret
 * @returns 32-byte AES-256 key
 */
export function deriveMessageKey(sharedSecret: Uint8Array): Uint8Array {
  // Use HKDF with no salt (null → zeroed), info = "muster-e2e-dm-v1"
  return hkdf(sha256, sharedSecret, undefined, HKDF_INFO, 32);
}

// =================================================================
// Message Encryption / Decryption
// =================================================================

/**
 * Encrypt a plaintext message with AES-256-GCM.
 *
 * Returns a base64 string: IV (12 bytes) + ciphertext + auth tag.
 * A fresh random IV is generated for each message.
 *
 * @param plaintext - UTF-8 message string
 * @param key - 32-byte AES key (from deriveMessageKey)
 * @returns base64-encoded encrypted payload
 */
export function encryptMessage(plaintext: string, key: Uint8Array): string {
  const iv = randomBytes(IV_BYTES);
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const cipher = gcm(key, iv);
  const ciphertext = cipher.encrypt(plaintextBytes);

  // Combine IV + ciphertext into a single buffer
  const combined = new Uint8Array(IV_BYTES + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, IV_BYTES);

  return bytesToBase64(combined);
}

/**
 * Decrypt a message encrypted with encryptMessage.
 *
 * @param encoded - base64-encoded payload (IV + ciphertext)
 * @param key - 32-byte AES key (same key used for encryption)
 * @returns Decrypted UTF-8 string
 * @throws {Error} If decryption fails (wrong key or tampered data)
 */
export function decryptMessage(encoded: string, key: Uint8Array): string {
  const combined = base64ToBytes(encoded);
  if (combined.length < IV_BYTES + 1) {
    throw new Error('Invalid encrypted payload: too short');
  }

  const iv = combined.slice(0, IV_BYTES);
  const ciphertext = combined.slice(IV_BYTES);
  const cipher = gcm(key, iv);
  const plaintext = cipher.decrypt(ciphertext);

  return new TextDecoder().decode(plaintext);
}

// =================================================================
// High-level: encrypt/decrypt for DMs
// =================================================================

/**
 * Encrypt a DM message for a specific recipient.
 *
 * Performs the full pipeline:
 * 1. Convert Ed25519 keys to X25519
 * 2. ECDH shared secret
 * 3. HKDF key derivation
 * 4. AES-256-GCM encryption
 *
 * @param plaintext - The message to encrypt
 * @param myEdPrivateKey - Sender's Ed25519 private key
 * @param theirEdPublicKey - Recipient's Ed25519 public key
 * @returns Prefixed encrypted string (__E2E__ + base64)
 */
export function encryptDM(
  plaintext: string,
  myEdPrivateKey: Uint8Array,
  theirEdPublicKey: Uint8Array,
): string {
  const myX = edPrivateToX25519(myEdPrivateKey);
  const theirX = edPublicToX25519(theirEdPublicKey);
  const shared = computeSharedSecret(myX, theirX);
  const key = deriveMessageKey(shared);
  return E2E_PREFIX + encryptMessage(plaintext, key);
}

/**
 * Decrypt a DM message from a specific sender.
 *
 * @param content - The message content (with or without __E2E__ prefix)
 * @param myEdPrivateKey - Recipient's Ed25519 private key
 * @param theirEdPublicKey - Sender's Ed25519 public key
 * @returns Decrypted plaintext, or original content if not encrypted
 */
export function decryptDM(
  content: string,
  myEdPrivateKey: Uint8Array,
  theirEdPublicKey: Uint8Array,
): string {
  if (!content.startsWith(E2E_PREFIX)) {
    // Not encrypted — return as-is (backward compatibility)
    return content;
  }

  const encoded = content.slice(E2E_PREFIX.length);
  const myX = edPrivateToX25519(myEdPrivateKey);
  const theirX = edPublicToX25519(theirEdPublicKey);
  const shared = computeSharedSecret(myX, theirX);
  const key = deriveMessageKey(shared);
  return decryptMessage(encoded, key);
}

/**
 * Check if a message content string is E2E encrypted.
 */
export function isE2EEncrypted(content: string): boolean {
  return content.startsWith(E2E_PREFIX);
}

// =================================================================
// Base64 helpers (browser-compatible, no Buffer dependency)
// =================================================================

function bytesToBase64(bytes: Uint8Array): string {
  // Use Buffer if available (Node), fallback to btoa (browser)
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
