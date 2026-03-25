/**
 * @muster/transport — Transport Abstraction Layer
 *
 * This file defines the interface that ALL transports must implement.
 * Currently: WebSocketTransport
 * Future:    BLETransport (Bluetooth Low Energy)
 *
 * Any code that uses a transport should depend on these interfaces,
 * never on a specific implementation. This means swapping WebSocket
 * for BLE (or adding both) requires zero changes in consuming code.
 */

// -----------------------------------------------------------------
// Messages
// -----------------------------------------------------------------

/**
 * Every message sent or received through any transport has this shape.
 * The `type` field is the routing key (e.g. 'PUBLISH', 'SUBSCRIBE').
 */
export interface TransportMessage {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
  signature?: string;
  senderPublicKey?: string;
}

// -----------------------------------------------------------------
// Events
// -----------------------------------------------------------------

export type TransportEvents = {
  connected: () => void;
  disconnected: (reason: string) => void;
  message: (msg: TransportMessage) => void;
  error: (err: Error) => void;
}

// -----------------------------------------------------------------
// Transport interface
// -----------------------------------------------------------------

export interface Transport {
  /** Connect to a relay node (or BLE peer). */
  connect(address: string): Promise<void>;

  /** Gracefully close the connection. */
  disconnect(): void;

  /** Send a message through the transport. */
  send(msg: TransportMessage): void;

  /** Register an event handler. */
  on<K extends keyof TransportEvents>(
    event: K,
    handler: TransportEvents[K]
  ): void;

  /** Remove an event handler. */
  off<K extends keyof TransportEvents>(
    event: K,
    handler: TransportEvents[K]
  ): void;

  /** Whether the transport is currently connected and ready. */
  readonly isConnected: boolean;
}

// -----------------------------------------------------------------
// Tiny typed event emitter (works in browser + Node, zero deps)
// -----------------------------------------------------------------

export class TypedEmitter<Events extends Record<string, (...args: any[]) => void>> {
  private listeners = new Map<keyof Events, Set<Function>>();

  on<K extends keyof Events>(event: K, handler: Events[K]): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  off<K extends keyof Events>(event: K, handler: Events[K]): void {
    this.listeners.get(event)?.delete(handler);
  }

  protected emit<K extends keyof Events>(
    event: K,
    ...args: Parameters<Events[K]>
  ): void {
    this.listeners.get(event)?.forEach((fn) => {
      try { (fn as any)(...args); } catch { /* don't let one handler break others */ }
    });
  }
}
