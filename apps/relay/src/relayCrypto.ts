/**
 * Relay Crypto Helper — loads @muster/crypto via dynamic import
 * to handle ESM/CJS interop (relay is CJS, crypto is ESM).
 *
 * Call initCrypto() once at startup, then use verifySig() everywhere.
 */

const encoder = new TextEncoder();

let verifyFn: ((sig: Uint8Array, msg: Uint8Array, pub: Uint8Array) => Promise<boolean>) | null = null;
let fromHexFn: ((hex: string) => Uint8Array) | null = null;

/** Initialize crypto functions. Call once at startup. */
export async function initCrypto(): Promise<void> {
  try {
    const crypto = await import('@muster/crypto');
    verifyFn = crypto.verify;
    fromHexFn = crypto.fromHex;
    console.log('[relay] Ed25519 crypto loaded successfully');
  } catch (err) {
    console.error('[relay] Failed to load @muster/crypto:', err);
    console.warn('[relay] Signature verification will be DISABLED (accepting all signatures)');
  }
}

/**
 * Verify an Ed25519 signature.
 * @param message   — the original plaintext string that was signed
 * @param signature — hex-encoded 64-byte Ed25519 signature
 * @param publicKey — hex-encoded 32-byte Ed25519 public key
 * @returns true if valid, false if invalid. Returns true if crypto not loaded (graceful fallback).
 */
export async function verifySig(message: string, signature: string, publicKey: string): Promise<boolean> {
  if (!verifyFn || !fromHexFn) {
    // Crypto not loaded — accept all (graceful degradation during development)
    return true;
  }

  if (!signature || !publicKey) return false;

  try {
    const msgBytes = encoder.encode(message);
    const sigBytes = fromHexFn(signature);
    const pubBytes = fromHexFn(publicKey);
    return await verifyFn(sigBytes, msgBytes, pubBytes);
  } catch (err) {
    console.warn('[relay] Signature verification error:', (err as Error).message);
    return false;
  }
}
