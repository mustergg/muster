/**
 * @muster/crypto — shared types
 *
 * All types used across the crypto package and exported for consumers.
 */

/** Raw 32-byte Ed25519 public key */
export type PublicKeyBytes = Uint8Array;

/** Raw 32-byte Ed25519 private key (scalar) */
export type PrivateKeyBytes = Uint8Array;

/** 64-byte Ed25519 signature */
export type SignatureBytes = Uint8Array;

/** 32-byte AES-256 symmetric key */
export type SymmetricKeyBytes = Uint8Array;

/** 16-byte AES-GCM initialisation vector */
export type IVBytes = Uint8Array;

/**
 * A complete Ed25519 identity keypair.
 * The private key is NEVER serialised or transmitted — it lives in memory only.
 */
export interface KeyPair {
  /** Ed25519 public key — 32 bytes, safe to share */
  publicKey: PublicKeyBytes;
  /** Ed25519 private key — 32 bytes, NEVER share or persist unencrypted */
  privateKey: PrivateKeyBytes;
}

/**
 * The data stored in the user's local keystore file / IndexedDB entry.
 * The private key is encrypted with AES-256-GCM before storage.
 */
export interface KeystoreEntry {
  /** Username this keystore belongs to */
  username: string;
  /** Hex-encoded Ed25519 public key */
  publicKeyHex: string;
  /** Base64-encoded AES-256-GCM encrypted private key */
  encryptedPrivateKey: string;
  /** Base64-encoded AES-GCM IV (12 bytes) */
  iv: string;
  /** Base64-encoded PBKDF2 salt (32 bytes) */
  salt: string;
  /** PBKDF2 iteration count — stored so we can increase it in future versions */
  pbkdf2Iterations: number;
  /** Keystore format version — for future migration */
  version: 1;
  /** ISO timestamp of when this keystore was created */
  createdAt: string;
}

/**
 * Result of encrypting data with AES-256-GCM.
 */
export interface EncryptedPayload {
  /** Base64-encoded ciphertext + auth tag */
  ciphertext: string;
  /** Base64-encoded 12-byte IV */
  iv: string;
}

/**
 * A signed message envelope — every message sent over the network uses this.
 */
export interface SignedEnvelope {
  /** Base64-encoded payload bytes */
  payload: string;
  /** Hex-encoded Ed25519 public key of the signer */
  signerPublicKeyHex: string;
  /** Base64-encoded 64-byte Ed25519 signature over the payload bytes */
  signature: string;
}
