/**
 * @muster/crypto — Ed25519 message signing and verification
 *
 * Every message sent over the Muster network is signed by the sender.
 * Recipients verify the signature before accepting any message.
 * This prevents impersonation and data tampering.
 */

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import type {
  PrivateKeyBytes,
  PublicKeyBytes,
  SignatureBytes,
  SignedEnvelope,
} from './types.js';
import { toHex, toBase64, fromBase64, fromHex } from './keys.js';

ed.etc.sha512Sync = (...msgs) => sha512(ed.etc.concatBytes(...msgs));

/**
 * Sign arbitrary bytes with an Ed25519 private key.
 *
 * @param message   - The raw bytes to sign (e.g., serialised message payload)
 * @param privateKey - The signer's 32-byte Ed25519 private key
 * @returns 64-byte signature
 */
export async function sign(
  message: Uint8Array,
  privateKey: PrivateKeyBytes,
): Promise<SignatureBytes> {
  return ed.signAsync(message, privateKey);
}

/**
 * Verify an Ed25519 signature.
 *
 * @param signature  - 64-byte Ed25519 signature
 * @param message    - The original signed bytes
 * @param publicKey  - The claimed signer's 32-byte public key
 * @returns true if the signature is valid, false otherwise
 */
export async function verify(
  signature: SignatureBytes,
  message: Uint8Array,
  publicKey: PublicKeyBytes,
): Promise<boolean> {
  try {
    return await ed.verifyAsync(signature, message, publicKey);
  } catch {
    // @noble/ed25519 throws on malformed inputs — treat as invalid
    return false;
  }
}

/**
 * Wrap an arbitrary payload in a signed envelope.
 *
 * The envelope is what is actually sent over the network.
 * Recipients call `openEnvelope` to verify and extract the payload.
 *
 * @param payload    - Arbitrary bytes (typically a serialised protocol message)
 * @param privateKey - Signer's private key
 * @param publicKey  - Signer's public key (included in the envelope for verification)
 */
export async function createEnvelope(
  payload: Uint8Array,
  privateKey: PrivateKeyBytes,
  publicKey: PublicKeyBytes,
): Promise<SignedEnvelope> {
  const signature = await sign(payload, privateKey);
  return {
    payload: toBase64(payload),
    signerPublicKeyHex: toHex(publicKey),
    signature: toBase64(signature),
  };
}

/**
 * Verify a signed envelope and return the inner payload bytes.
 *
 * @param envelope - The envelope received from the network
 * @returns The raw payload bytes if the signature is valid
 * @throws {Error} If the signature is invalid — always check, never skip
 */
export async function openEnvelope(envelope: SignedEnvelope): Promise<Uint8Array> {
  const payload   = fromBase64(envelope.payload);
  const signature = fromBase64(envelope.signature);
  const publicKey = fromHex(envelope.signerPublicKeyHex);

  const valid = await verify(signature, payload, publicKey);
  if (!valid) {
    throw new Error(
      `Invalid signature from peer ${envelope.signerPublicKeyHex.slice(0, 12)}...`,
    );
  }
  return payload;
}
