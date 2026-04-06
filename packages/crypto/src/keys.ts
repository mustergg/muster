/**
 * @muster/crypto — key generation and management
 *
 * Generates and handles Ed25519 keypairs used as Muster user identities.
 * Based on @noble/ed25519 — a well-audited, zero-dependency implementation.
 *
 * R11-fix: Added deriveKeyPair() for deterministic cross-device identity.
 */

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import type { KeyPair, PublicKeyBytes, PrivateKeyBytes } from './types.js';

// @noble/ed25519 v2 requires an explicit SHA-512 implementation in non-browser envs
ed.etc.sha512Sync = (...msgs) => sha512(ed.etc.concatBytes(...msgs));

/**
 * Generate a new random Ed25519 keypair.
 *
 * @returns A fresh { publicKey, privateKey } pair.
 *
 * @example
 * const keypair = await generateKeyPair();
 * console.log('Public key (hex):', toHex(keypair.publicKey));
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const privateKey: PrivateKeyBytes = ed.utils.randomPrivateKey();
  const publicKey: PublicKeyBytes = await ed.getPublicKeyAsync(privateKey);
  return { publicKey, privateKey };
}

/**
 * Derive a deterministic Ed25519 keypair from username + password.
 *
 * Uses PBKDF2-SHA512 with 210,000 iterations to derive a 32-byte seed
 * from the credentials. The same username+password will always produce
 * the same keypair on any device.
 *
 * The salt is "muster-identity:" + lowercase(username), ensuring different
 * users with the same password get different keys.
 *
 * @param username - The user's username (case-insensitive for derivation)
 * @param password - The user's password
 * @returns Deterministic { publicKey, privateKey } pair
 */
export async function deriveKeyPair(username: string, password: string): Promise<KeyPair> {
  const encoder = new TextEncoder();
  const salt = encoder.encode('muster-identity:' + username.toLowerCase());
  const seed = await pbkdf2Async(sha512, encoder.encode(password), salt, {
    c: 210_000,
    dkLen: 32,
  });
  const privateKey = new Uint8Array(seed) as PrivateKeyBytes;
  const publicKey: PublicKeyBytes = await ed.getPublicKeyAsync(privateKey);
  return { publicKey, privateKey };
}

/**
 * Derive the public key from an existing private key.
 *
 * Useful when loading a private key from the keystore and needing to
 * reconstruct the full keypair.
 *
 * @param privateKey - 32-byte Ed25519 private key
 */
export async function getPublicKey(privateKey: PrivateKeyBytes): Promise<PublicKeyBytes> {
  return ed.getPublicKeyAsync(privateKey);
}

/**
 * Convert a Uint8Array to a lowercase hex string.
 *
 * @example
 * toHex(keypair.publicKey) // "a3f7e1..."
 */
export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/**
 * Convert a lowercase hex string back to Uint8Array.
 *
 * @throws {Error} If the hex string has an odd length or invalid characters.
 */
export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`Invalid hex string length: ${hex.length}`);
  }
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

/**
 * Convert a Uint8Array to a base64 string.
 */
export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Convert a base64 string back to Uint8Array.
 */
export function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
