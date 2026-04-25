/**
 * @muster/dht — canonical CBOR codecs (R25 / Phase 6).
 *
 * Wire encoding for DHT RPCs. Maps are canonical (key ordering enforced
 * by @muster/crypto/encodeCanonical).
 */

import type {
  Contact,
  DhtMessage,
  DhtRecord,
  DhtFindNode,
  DhtFindNodeResp,
  DhtFindValue,
  DhtFindValueResp,
  DhtPing,
  DhtPong,
  DhtStore,
  DhtStoreAck,
  RecordKind,
} from './types.js';

// ─── Contact ───────────────────────────────────────────────────────────────

export function contactToCborMap(c: Contact): Record<string, unknown> {
  return {
    nodeId: c.nodeId,
    nodeId160: c.nodeId160,
    pubkey: c.pubkey,
    wsUrl: c.wsUrl,
    lastSeen: c.lastSeen,
  };
}

export function contactFromCborMap(m: Record<string, unknown>): Contact {
  return {
    nodeId: asBytes(m.nodeId, 'contact.nodeId'),
    nodeId160: asBytes(m.nodeId160, 'contact.nodeId160'),
    pubkey: asBytes(m.pubkey, 'contact.pubkey'),
    wsUrl: asString(m.wsUrl, 'contact.wsUrl'),
    lastSeen: asNumber(m.lastSeen, 'contact.lastSeen'),
  };
}

// ─── Record ────────────────────────────────────────────────────────────────

export function recordToCborMap(r: DhtRecord): Record<string, unknown> {
  return {
    key: r.key,
    kind: r.kind,
    providerPubkey: r.providerPubkey,
    wsUrl: r.wsUrl,
    ts: r.ts,
    ttlMs: r.ttlMs,
    sig: r.sig,
  };
}

/** Same as recordToCborMap minus `sig` — used as the signing payload. */
export function recordToUnsignedCborMap(r: DhtRecord): Record<string, unknown> {
  return {
    key: r.key,
    kind: r.kind,
    providerPubkey: r.providerPubkey,
    wsUrl: r.wsUrl,
    ts: r.ts,
    ttlMs: r.ttlMs,
  };
}

export function recordFromCborMap(m: Record<string, unknown>): DhtRecord {
  const kind = m.kind;
  if (kind !== 'COMMUNITY_PEERS' && kind !== 'PIECE_PROVIDERS' && kind !== 'INBOX_ROUTE') {
    throw new Error(`dht: invalid record.kind ${String(kind)}`);
  }
  return {
    key: asBytes(m.key, 'record.key'),
    kind: kind as RecordKind,
    providerPubkey: asBytes(m.providerPubkey, 'record.providerPubkey'),
    wsUrl: asString(m.wsUrl, 'record.wsUrl'),
    ts: asNumber(m.ts, 'record.ts'),
    ttlMs: asNumber(m.ttlMs, 'record.ttlMs'),
    sig: asBytes(m.sig, 'record.sig'),
  };
}

// ─── RPC dispatch ──────────────────────────────────────────────────────────

export function dhtMessageToCborMap(msg: DhtMessage): Record<string, unknown> {
  switch (msg.kind) {
    case 'PING':
      return { kind: 'PING', nonce: msg.nonce };
    case 'PONG':
      return { kind: 'PONG', nonce: msg.nonce };
    case 'FIND_NODE':
      return { kind: 'FIND_NODE', target: msg.target, nonce: msg.nonce };
    case 'FIND_NODE_RESP':
      return {
        kind: 'FIND_NODE_RESP',
        contacts: msg.contacts.map(contactToCborMap),
        nonce: msg.nonce,
      };
    case 'STORE':
      return {
        kind: 'STORE',
        key: msg.key,
        value: recordToCborMap(msg.value),
        nonce: msg.nonce,
      };
    case 'STORE_ACK':
      return { kind: 'STORE_ACK', accepted: msg.accepted, nonce: msg.nonce };
    case 'FIND_VALUE':
      return { kind: 'FIND_VALUE', key: msg.key, nonce: msg.nonce };
    case 'FIND_VALUE_RESP': {
      const out: Record<string, unknown> = { kind: 'FIND_VALUE_RESP', nonce: msg.nonce };
      if (msg.found !== null) {
        out.found = msg.found.map(recordToCborMap);
      } else {
        out.found = null;
      }
      if (msg.closerContacts !== null) {
        out.closerContacts = msg.closerContacts.map(contactToCborMap);
      } else {
        out.closerContacts = null;
      }
      return out;
    }
  }
}

export function dhtMessageFromCborMap(m: Record<string, unknown>): DhtMessage {
  switch (m.kind) {
    case 'PING':
      return { kind: 'PING', nonce: asBytes(m.nonce, 'PING.nonce') } satisfies DhtPing;
    case 'PONG':
      return { kind: 'PONG', nonce: asBytes(m.nonce, 'PONG.nonce') } satisfies DhtPong;
    case 'FIND_NODE':
      return {
        kind: 'FIND_NODE',
        target: asBytes(m.target, 'FIND_NODE.target'),
        nonce: asBytes(m.nonce, 'FIND_NODE.nonce'),
      } satisfies DhtFindNode;
    case 'FIND_NODE_RESP':
      return {
        kind: 'FIND_NODE_RESP',
        contacts: asArray(m.contacts, 'contacts').map((c, i) => contactFromCborMap(asMap(c, `contacts[${i}]`))),
        nonce: asBytes(m.nonce, 'FIND_NODE_RESP.nonce'),
      } satisfies DhtFindNodeResp;
    case 'STORE':
      return {
        kind: 'STORE',
        key: asBytes(m.key, 'STORE.key'),
        value: recordFromCborMap(asMap(m.value, 'STORE.value')),
        nonce: asBytes(m.nonce, 'STORE.nonce'),
      } satisfies DhtStore;
    case 'STORE_ACK':
      return {
        kind: 'STORE_ACK',
        accepted: m.accepted === true,
        nonce: asBytes(m.nonce, 'STORE_ACK.nonce'),
      } satisfies DhtStoreAck;
    case 'FIND_VALUE':
      return {
        kind: 'FIND_VALUE',
        key: asBytes(m.key, 'FIND_VALUE.key'),
        nonce: asBytes(m.nonce, 'FIND_VALUE.nonce'),
      } satisfies DhtFindValue;
    case 'FIND_VALUE_RESP': {
      const found = m.found === null
        ? null
        : asArray(m.found, 'found').map((r, i) => recordFromCborMap(asMap(r, `found[${i}]`)));
      const closer = m.closerContacts === null
        ? null
        : asArray(m.closerContacts, 'closerContacts').map((c, i) => contactFromCborMap(asMap(c, `closerContacts[${i}]`)));
      return {
        kind: 'FIND_VALUE_RESP',
        found,
        closerContacts: closer,
        nonce: asBytes(m.nonce, 'FIND_VALUE_RESP.nonce'),
      } satisfies DhtFindValueResp;
    }
    default:
      throw new Error(`dht: unknown message kind ${String(m.kind)}`);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function asBytes(v: unknown, label: string): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v) && v.every((b) => typeof b === 'number')) return new Uint8Array(v);
  throw new Error(`dht: ${label} not bytes`);
}

function asString(v: unknown, label: string): string {
  if (typeof v === 'string') return v;
  throw new Error(`dht: ${label} not a string`);
}

function asNumber(v: unknown, label: string): number {
  if (typeof v === 'number') return v;
  throw new Error(`dht: ${label} not a number`);
}

function asArray(v: unknown, label: string): unknown[] {
  if (Array.isArray(v)) return v;
  throw new Error(`dht: ${label} not an array`);
}

function asMap(v: unknown, label: string): Record<string, unknown> {
  if (typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array)) {
    return v as Record<string, unknown>;
  }
  throw new Error(`dht: ${label} not a map`);
}
