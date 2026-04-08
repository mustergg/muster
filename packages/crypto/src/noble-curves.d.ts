/**
 * Type declarations for @noble/curves/ed25519 subpath.
 * Needed because TypeScript + pnpm can't resolve subpath types automatically.
 */

declare module '@noble/curves/ed25519' {
  /** Convert Ed25519 private key to X25519 private key (Curve25519). */
  export function edwardsToMontgomeryPriv(edPrivateKey: Uint8Array): Uint8Array;

  /** Convert Ed25519 public key to X25519 public key (Curve25519). */
  export function edwardsToMontgomeryPub(edPublicKey: Uint8Array): Uint8Array;

  /** X25519 Diffie-Hellman key exchange. */
  export const x25519: {
    /** Compute shared secret: X25519(scalar, point). */
    scalarMult(scalar: Uint8Array, point: Uint8Array): Uint8Array;
  };

  /** Ed25519 signature scheme. */
  export const ed25519: {
    getPublicKey(privateKey: Uint8Array): Uint8Array;
    sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array;
    verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean;
  };
}
