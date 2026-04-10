/**
 * Type declarations for @noble/curves/ed25519.js (v2 API).
 */

declare module '@noble/curves/ed25519.js' {
  export const x25519: {
    scalarMult(scalar: Uint8Array, point: Uint8Array): Uint8Array;
    getSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array;
    getPublicKey(privateKey: Uint8Array): Uint8Array;
    scalarMultBase(scalar: Uint8Array): Uint8Array;
  };

  export const ed25519: {
    getPublicKey(privateKey: Uint8Array): Uint8Array;
    sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array;
    verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean;
  };
}
