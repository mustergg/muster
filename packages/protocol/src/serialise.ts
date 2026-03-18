/**
 * @muster/protocol — serialisation helpers
 *
 * All messages are serialised to JSON bytes before signing.
 * The bytes are what gets signed — not the JSON string —
 * so we use a deterministic serialiser (sorted keys).
 */

import type { MusterMessage } from './messages.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Serialise a MusterMessage to bytes for signing or network transmission.
 *
 * Keys are sorted alphabetically to ensure deterministic output —
 * the same message always produces the same bytes regardless of insertion order.
 */
export function serialise(message: MusterMessage): Uint8Array {
  const json = JSON.stringify(message, Object.keys(message).sort());
  return encoder.encode(json);
}

/**
 * Deserialise bytes back to a MusterMessage.
 *
 * @throws {Error} If the bytes are not valid JSON or the type field is missing.
 */
export function deserialise(bytes: Uint8Array): MusterMessage {
  const json = decoder.decode(bytes);
  const obj = JSON.parse(json) as Record<string, unknown>;

  if (typeof obj['type'] !== 'string') {
    throw new Error('Deserialised object has no "type" field');
  }
  if (typeof obj['id'] !== 'string') {
    throw new Error('Deserialised object has no "id" field');
  }

  return obj as unknown as MusterMessage;
}

/**
 * Generate a UUID v4 using the Web Crypto API.
 * Works in both browsers and Node.js 20+.
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get the current Unix timestamp in milliseconds.
 */
export function now(): number {
  return Date.now();
}
