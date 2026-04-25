/**
 * @muster/dht — types (R25 / Phase 6).
 *
 * Spec: docs/specs/DHT.md.
 */

// ─── Constants ─────────────────────────────────────────────────────────────

export const KAD_K = 20;            // bucket size
export const KAD_ALPHA = 3;         // parallel lookups
export const KAD_KEY_BITS = 160;    // routing keyspace
export const KAD_KEY_BYTES = 20;
export const KAD_NODE_ID_BYTES = 32;
export const KAD_PUBKEY_BYTES = 32;
export const KAD_NONCE_BYTES = 16;
export const KAD_SIG_BYTES = 64;

export const KAD_TTL_MS = 60 * 60 * 1000;            // 1 h record lifetime
export const KAD_REFRESH_MS = 45 * 60 * 1000;        // 45 min advertiser republish
export const KAD_REPLICATE_MS = 60 * 60 * 1000;      // 1 h node replicate
export const KAD_REPUBLISH_MS = 24 * 60 * 60 * 1000; // 24 h originator
export const KAD_BUCKET_REFRESH_MS = 60 * 60 * 1000; // 1 h
export const KAD_RPC_TIMEOUT_MS = 5_000;
export const KAD_RECORD_CLOCK_SKEW_MS = 30 * 60 * 1000; // ±30 min on `ts`

export const KAD_MAX_RECORDS_PER_KEY_PROVIDER = 10;
export const KAD_STORE_RATE_PER_MIN = 50;

// ─── Identity ──────────────────────────────────────────────────────────────

/** A peer in the DHT. */
export interface Contact {
  /** 32 bytes — H(pubkey). Used in auth/sig contexts. */
  nodeId: Uint8Array;
  /** 20 bytes — H(pubkey)[:20]. Used as the routing key. */
  nodeId160: Uint8Array;
  /** 32 bytes — Ed25519 pubkey. */
  pubkey: Uint8Array;
  /** "ws://..." / "wss://...". */
  wsUrl: string;
  /** ms since epoch. */
  lastSeen: number;
}

// ─── Record ────────────────────────────────────────────────────────────────

export type RecordKind = 'COMMUNITY_PEERS' | 'PIECE_PROVIDERS' | 'INBOX_ROUTE';

/**
 * A signed advertisement: "I (providerPubkey) hold the content keyed at
 * `key` and you can reach me at `wsUrl`."
 */
export interface DhtRecord {
  /** 20 bytes. See record-key derivation in DHT.md. */
  key: Uint8Array;
  kind: RecordKind;
  /** 32 bytes — Ed25519 of the advertiser. */
  providerPubkey: Uint8Array;
  wsUrl: string;
  /** ms since epoch — refresh time. */
  ts: number;
  /** typically KAD_TTL_MS. */
  ttlMs: number;
  /** 64 bytes — Ed25519 over canonicalCBOR(record \ sig). */
  sig: Uint8Array;
}

// ─── RPCs ──────────────────────────────────────────────────────────────────

export type DhtMessageKind =
  | 'PING' | 'PONG'
  | 'FIND_NODE' | 'FIND_NODE_RESP'
  | 'STORE' | 'STORE_ACK'
  | 'FIND_VALUE' | 'FIND_VALUE_RESP';

export interface DhtPing { kind: 'PING'; nonce: Uint8Array; }
export interface DhtPong { kind: 'PONG'; nonce: Uint8Array; }
export interface DhtFindNode { kind: 'FIND_NODE'; target: Uint8Array; nonce: Uint8Array; }
export interface DhtFindNodeResp { kind: 'FIND_NODE_RESP'; contacts: Contact[]; nonce: Uint8Array; }
export interface DhtStore { kind: 'STORE'; key: Uint8Array; value: DhtRecord; nonce: Uint8Array; }
export interface DhtStoreAck { kind: 'STORE_ACK'; accepted: boolean; nonce: Uint8Array; }
export interface DhtFindValue { kind: 'FIND_VALUE'; key: Uint8Array; nonce: Uint8Array; }
export interface DhtFindValueResp {
  kind: 'FIND_VALUE_RESP';
  /** Non-null when records were found at this node. */
  found: DhtRecord[] | null;
  /** Provided when `found === null`. Up to k closer contacts. */
  closerContacts: Contact[] | null;
  nonce: Uint8Array;
}

export type DhtMessage =
  | DhtPing | DhtPong
  | DhtFindNode | DhtFindNodeResp
  | DhtStore | DhtStoreAck
  | DhtFindValue | DhtFindValueResp;

// ─── Browser bridge ────────────────────────────────────────────────────────

/**
 * Wrapped DHT_QUERY browser → relay request:
 *   { type:'DHT_QUERY', payload:{ kind:'piece_providers'|'community_peers'|'inbox_route', id:'<base64-or-hex>' } }
 *
 * Response:
 *   { type:'DHT_QUERY_RESPONSE', payload:{ records:[{providerPubkey, wsUrl, ts}, ...] } }
 */
export type DhtQueryKind = 'piece_providers' | 'community_peers' | 'inbox_route';
