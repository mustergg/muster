/**
 * Internal types for the relay server.
 * These are NOT part of the public protocol — they only exist inside apps/relay.
 */

import type { WebSocket } from 'ws';

/** Represents a single connected client. */
export interface RelayClient {
  /** The underlying WebSocket connection. */
  ws: WebSocket;

  /** Ed25519 public key hex (set after authentication). */
  publicKey: string;

  /** Human-readable username (set after authentication). */
  username: string;

  /** Whether this client has completed the auth handshake. */
  authenticated: boolean;

  /** The random challenge string sent to this client. */
  challenge: string;

  /** Set of channel IDs this client is subscribed to. */
  channels: Set<string>;

  /** Timestamp of when the client connected. */
  connectedAt: number;

  /** User-chosen availability: 'online' | 'idle' | 'dnd' | 'invisible'.
   *  Defaults to 'online' on auth. 'invisible' is masked as offline to others. */
  status?: string;

  /** Free-text mood / activity line (Rich Presence placeholder). */
  mood?: string;

  /** Client-reported last user-activity time (ms). Used to pick the
   *  most-recently-used device when the same account is online on several,
   *  so presence shows one entry with the freshest device's status. */
  lastActivity?: number;
}
