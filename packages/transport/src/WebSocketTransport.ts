/**
 * WebSocketTransport — connects to a Muster relay node via WebSocket.
 *
 * Works in any browser (WebSocket is native).
 * Auto-reconnects with exponential backoff if the connection drops.
 * Zero native dependencies.
 */

import {
  Transport,
  TransportMessage,
  TransportEvents,
  TypedEmitter,
} from './types';

/** Configuration options for the WebSocket transport. */
export interface WebSocketTransportOptions {
  /** Base delay between reconnect attempts in ms (default: 2000). */
  reconnectBaseDelay?: number;
  /** Maximum delay between reconnect attempts in ms (default: 30000). */
  reconnectMaxDelay?: number;
  /** Maximum number of reconnect attempts before giving up (default: Infinity). */
  maxReconnectAttempts?: number;
}

export class WebSocketTransport
  extends TypedEmitter<TransportEvents>
  implements Transport
{
  private ws: WebSocket | null = null;
  private url = '';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionalClose = false;

  private readonly reconnectBaseDelay: number;
  private readonly reconnectMaxDelay: number;
  private readonly maxReconnectAttempts: number;

  constructor(options: WebSocketTransportOptions = {}) {
    super();
    this.reconnectBaseDelay = options.reconnectBaseDelay ?? 2000;
    this.reconnectMaxDelay = options.reconnectMaxDelay ?? 30000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? Infinity;
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async connect(url: string): Promise<void> {
    this.url = url;
    this.intentionalClose = false;
    this.reconnectAttempts = 0;

    return this.doConnect();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnect();
    if (this.ws) {
      this.ws.onclose = null; // prevent reconnect trigger
      this.ws.close(1000, 'client disconnect');
      this.ws = null;
    }
    this.emit('disconnected', 'client disconnect');
  }

  send(msg: TransportMessage): void {
    if (!this.isConnected) {
      console.warn('[transport] Cannot send — not connected');
      return;
    }
    try {
      this.ws!.send(JSON.stringify(msg));
    } catch (err) {
      console.error('[transport] Send error:', err);
    }
  }

  // ---------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------

  private doConnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
      } catch (err) {
        reject(new Error(`WebSocket creation failed: ${err}`));
        return;
      }

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.emit('connected');
        resolve();
      };

      this.ws.onclose = (event) => {
        if (this.intentionalClose) return;
        this.emit('disconnected', event.reason || 'connection lost');
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        // onerror is always followed by onclose, so we only reject
        // the initial connect promise here — reconnect is handled in onclose.
        if (this.reconnectAttempts === 0) {
          reject(new Error('WebSocket connection failed'));
        }
        this.emit('error', new Error('WebSocket error'));
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(
            typeof event.data === 'string' ? event.data : ''
          ) as TransportMessage;
          this.emit('message', msg);
        } catch {
          // Ignore malformed messages — don't crash the transport
        }
      };
    });
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[transport] Max reconnect attempts reached — giving up');
      this.emit('error', new Error('Max reconnect attempts reached'));
      return;
    }

    // Exponential backoff with jitter
    const delay = Math.min(
      this.reconnectBaseDelay * Math.pow(1.5, this.reconnectAttempts)
        + Math.random() * 500,
      this.reconnectMaxDelay
    );

    this.reconnectAttempts++;
    console.log(
      `[transport] Reconnecting in ${Math.round(delay)}ms`
      + ` (attempt ${this.reconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.doConnect().catch(() => {
        // doConnect failed — onclose will trigger scheduleReconnect again
      });
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
