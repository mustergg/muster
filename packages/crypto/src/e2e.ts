/**
 * @muster/crypto — End-to-End Encryption (R14)
 *
 * E2E encrypted messaging for DMs using ECDH (X25519) + AES-256-GCM.
 * Key conversion from Ed25519 → X25519 implemented manually (v2 compatible).
 */

import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2'; //'@noble/hashes/sha256' deprecated using '@noble/hashes/sha2'
import { sha512 } from '@noble/hashes/sha2'; //'@noble/hashes/sha512' deprecated using '@noble/hashes/sha2'
import { gcm } from '@noble/ciphers/aes';
import { randomBytes } from '@noble/hashes/utils';

const IV_BYTES = 12;
const HKDF_INFO = new TextEncoder().encode('muster-e2e-dm-v1');
export const E2E_PREFIX = '__E2E__';

/** Curve25519 prime: 2^255 - 19 */
const P = 2n ** 255n - 19n;

// =================================================================
// BigInt modular arithmetic
// =================================================================

function mod(a: bigint, p: bigint): bigint {
  const r = a % p;
  return r >= 0n ? r : r + p;
}

function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  let result = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) result = mod(result * base, m);
    exp >>= 1n;
    base = mod(base * base, m);
  }
  return result;
}

function modInverse(a: bigint, p: bigint): bigint {
  return modPow(a, p - 2n, p);
}

// =================================================================
// Key conversion: Ed25519 → X25519
// =================================================================

/**
 * Convert Ed25519 private key (seed) to X25519 private key.
 * SHA-512 the seed, take first 32 bytes, clamp per RFC 7748.
 */
export function edPrivateToX25519(edSeed: Uint8Array): Uint8Array {
  const hash = sha512(new Uint8Array(edSeed));
  const result = new Uint8Array(32);
  for (let i = 0; i < 32; i++) result[i] = hash[i]!;
  result[0]! &= 248;
  result[31]! &= 127;
  result[31]! |= 64;
  return result;
}

/**
 * Convert Ed25519 public key to X25519 public key.
 * Birational map: u = (1 + y) / (1 - y) mod p.
 */
export function edPublicToX25519(edPublicKey: Uint8Array): Uint8Array {
  // Copy and clear sign bit to extract y-coordinate
  const yBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) yBytes[i] = edPublicKey[i]!;
  yBytes[31]! &= 0x7f;

  // Read y as little-endian BigInt
  let y = 0n;
  for (let i = 0; i < 32; i++) {
    y |= BigInt(yBytes[i]!) << BigInt(8 * i);
  }

  // u = (1 + y) / (1 - y) mod p
  const numerator = mod(1n + y, P);
  const denominator = mod(1n - y, P);
  const u = mod(numerator * modInverse(denominator, P), P);

  // Write u as little-endian 32 bytes
  const result = new Uint8Array(32);
  let val = u;
  for (let i = 0; i < 32; i++) {
    result[i] = Number(val & 0xffn);
    val >>= 8n;
  }
  return result;
}

// =================================================================
// ECDH + Key Derivation
// =================================================================

/**
 * Compute ECDH shared secret using x25519.getSharedSecret (v2 high-level API).
 */
export function computeSharedSecret(
  myX25519Private: Uint8Array,
  theirX25519Public: Uint8Array,
): Uint8Array {
  return x25519.getSharedSecret(myX25519Private, theirX25519Public);
  //return x25519.scalarMult(myX25519Private, theirX25519Public);
}

/**
 * Derive AES-256-GCM key from ECDH shared secret via HKDF-SHA256.
 */
export function deriveMessageKey(sharedSecret: Uint8Array): Uint8Array {
  return hkdf(sha256, sharedSecret, undefined, HKDF_INFO, 32);
}

// =================================================================
// Message Encryption / Decryption
// =================================================================

export function encryptMessage(plaintext: string, key: Uint8Array): string {
  const iv = randomBytes(IV_BYTES);
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const cipher = gcm(key, iv);
  const ciphertext = cipher.encrypt(plaintextBytes);

  const combined = new Uint8Array(IV_BYTES + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, IV_BYTES);
  return bytesToBase64(combined);
}

export function decryptMessage(encoded: string, key: Uint8Array): string {
  const combined = base64ToBytes(encoded);
  if (combined.length < IV_BYTES + 1) throw new Error('Invalid encrypted payload');

  const iv = combined.slice(0, IV_BYTES);
  const ciphertext = combined.slice(IV_BYTES);
  const cipher = gcm(key, iv);
  const plaintext = cipher.decrypt(ciphertext);
  return new TextDecoder().decode(plaintext);
}

// =================================================================
// High-level DM encrypt/decrypt
// =================================================================

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

export function decryptDM(
  content: string,
  myEdPrivateKey: Uint8Array,
  theirEdPublicKey: Uint8Array,
): string {
  if (!content.startsWith(E2E_PREFIX)) return content;

  const encoded = content.slice(E2E_PREFIX.length);
  const myX = edPrivateToX25519(myEdPrivateKey);
  const theirX = edPublicToX25519(theirEdPublicKey);
  const shared = computeSharedSecret(myX, theirX);
  const key = deriveMessageKey(shared);
  return decryptMessage(encoded, key);
}

export function isE2EEncrypted(content: string): boolean {
  return content.startsWith(E2E_PREFIX);
}

// =================================================================
// Base64 helpers
// =================================================================

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
