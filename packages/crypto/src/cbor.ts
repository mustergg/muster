/**
 * @muster/crypto/cbor — canonical CBOR encoder / decoder (deterministic).
 *
 * R25 — Phase 1 (ENVELOPE/BLOB specs require canonical CBOR for signatures).
 *
 * Supported subset, per RFC 8949 §4.2:
 *   - unsigned integers (0..2^53-1)
 *   - negative integers down to -(2^53)
 *   - byte strings (Uint8Array)
 *   - text strings (UTF-8)
 *   - arrays (ordered)
 *   - maps (keys sorted bytewise by their CBOR encoding)
 *   - boolean, null
 *
 * NOT supported: floats, tagged items, indefinite length.
 *
 * Rationale: our signed wire structures only need the subset above.
 * Skipping floats means we never hit NaN-payload canonical issues;
 * skipping tags avoids IPLD-style extensions. Pure JS, no deps —
 * runs on ARM relay and browser without native modules.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Any value supported by the canonical encoder. */
export type CborValue =
  | number           // integer only; must be Number.isInteger
  | bigint           // used for uint64 beyond 2^53
  | string
  | Uint8Array
  | boolean
  | null
  | CborValue[]
  | { [k: string]: CborValue };

// ─── Encoder ────────────────────────────────────────────────────────────────

/**
 * Encode a value to canonical CBOR bytes.
 *
 * @throws if a value is of an unsupported type (undefined, float, symbol, ...)
 */
export function encodeCanonical(value: CborValue): Uint8Array {
  const chunks: Uint8Array[] = [];
  encodeInto(value, chunks);
  return concatBytes(chunks);
}

function encodeInto(value: CborValue, out: Uint8Array[]): void {
  if (value === null) {
    out.push(new Uint8Array([0xf6])); // null
    return;
  }
  if (typeof value === 'boolean') {
    out.push(new Uint8Array([value ? 0xf5 : 0xf4]));
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error(`cbor: floats are not supported (got ${value})`);
    }
    if (value >= 0) {
      out.push(encodeHead(0, BigInt(value)));
    } else {
      out.push(encodeHead(1, BigInt(-value - 1)));
    }
    return;
  }
  if (typeof value === 'bigint') {
    if (value >= 0n) {
      if (value > 0xffffffffffffffffn) throw new Error('cbor: uint out of range');
      out.push(encodeHead(0, value));
    } else {
      const neg = -value - 1n;
      if (neg > 0xffffffffffffffffn) throw new Error('cbor: nint out of range');
      out.push(encodeHead(1, neg));
    }
    return;
  }
  if (typeof value === 'string') {
    const utf8 = new TextEncoder().encode(value);
    out.push(encodeHead(3, BigInt(utf8.length)));
    out.push(utf8);
    return;
  }
  if (value instanceof Uint8Array) {
    out.push(encodeHead(2, BigInt(value.length)));
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    out.push(encodeHead(4, BigInt(value.length)));
    for (const item of value) encodeInto(item, out);
    return;
  }
  if (typeof value === 'object') {
    // Map: sort keys by their canonical CBOR-encoded form (bytewise lex).
    const entries = Object.entries(value);
    const encodedKeys = entries.map(([k, v]) => {
      const keyBytes = encodeCanonical(k);
      return { keyBytes, valueRef: v, rawKey: k };
    });
    encodedKeys.sort((a, b) => bytewiseCompare(a.keyBytes, b.keyBytes));
    out.push(encodeHead(5, BigInt(encodedKeys.length)));
    for (const { keyBytes, valueRef } of encodedKeys) {
      out.push(keyBytes);
      encodeInto(valueRef, out);
    }
    return;
  }
  throw new Error(`cbor: unsupported value type: ${typeof value}`);
}

/** Encode a CBOR head byte + length in smallest form. majorType in [0,7]. */
function encodeHead(majorType: number, n: bigint): Uint8Array {
  const m = (majorType & 7) << 5;
  if (n < 24n) return new Uint8Array([m | Number(n)]);
  if (n < 0x100n) return new Uint8Array([m | 24, Number(n)]);
  if (n < 0x10000n) {
    const buf = new Uint8Array(3);
    buf[0] = m | 25;
    buf[1] = Number((n >> 8n) & 0xffn);
    buf[2] = Number(n & 0xffn);
    return buf;
  }
  if (n < 0x100000000n) {
    const buf = new Uint8Array(5);
    buf[0] = m | 26;
    buf[1] = Number((n >> 24n) & 0xffn);
    buf[2] = Number((n >> 16n) & 0xffn);
    buf[3] = Number((n >> 8n) & 0xffn);
    buf[4] = Number(n & 0xffn);
    return buf;
  }
  const buf = new Uint8Array(9);
  buf[0] = m | 27;
  for (let i = 0; i < 8; i++) {
    buf[8 - i] = Number((n >> BigInt(i * 8)) & 0xffn);
  }
  return buf;
}

// ─── Decoder ────────────────────────────────────────────────────────────────

/**
 * Decode canonical CBOR bytes. Rejects inputs that aren't in canonical form
 * (non-minimal head, unsorted map keys, duplicate map keys, indefinite length).
 */
export function decodeCanonical(bytes: Uint8Array): CborValue {
  const state: DecState = { bytes, pos: 0 };
  const value = decodeItem(state);
  if (state.pos !== bytes.length) {
    throw new Error(`cbor: trailing bytes after value at pos ${state.pos}/${bytes.length}`);
  }
  return value;
}

interface DecState { bytes: Uint8Array; pos: number; }

function decodeItem(s: DecState): CborValue {
  if (s.pos >= s.bytes.length) throw new Error('cbor: unexpected end of input');
  const initial = s.bytes[s.pos]!;
  const majorType = initial >> 5;
  const minor = initial & 0x1f;
  s.pos += 1;

  if (minor === 31) throw new Error('cbor: indefinite-length not supported');

  let length: bigint;
  if (minor < 24) {
    length = BigInt(minor);
  } else if (minor === 24) {
    length = BigInt(readBytes(s, 1)[0]!);
    if (length < 24n) throw new Error('cbor: non-canonical length (24)');
  } else if (minor === 25) {
    const b = readBytes(s, 2);
    length = (BigInt(b[0]!) << 8n) | BigInt(b[1]!);
    if (length < 0x100n) throw new Error('cbor: non-canonical length (25)');
  } else if (minor === 26) {
    const b = readBytes(s, 4);
    length = (BigInt(b[0]!) << 24n) | (BigInt(b[1]!) << 16n) | (BigInt(b[2]!) << 8n) | BigInt(b[3]!);
    if (length < 0x10000n) throw new Error('cbor: non-canonical length (26)');
  } else if (minor === 27) {
    const b = readBytes(s, 8);
    length = 0n;
    for (let i = 0; i < 8; i++) length = (length << 8n) | BigInt(b[i]!);
    if (length < 0x100000000n) throw new Error('cbor: non-canonical length (27)');
  } else {
    // 28, 29, 30 are reserved; 31 already handled
    throw new Error(`cbor: reserved minor ${minor}`);
  }

  switch (majorType) {
    case 0: // unsigned int
      return length <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(length) : length;
    case 1: {
      const neg = -1n - length;
      return neg >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(neg) : neg;
    }
    case 2: // byte string
      return readBytes(s, Number(length));
    case 3: // text string
      return new TextDecoder('utf-8', { fatal: true }).decode(readBytes(s, Number(length)));
    case 4: { // array
      const n = Number(length);
      const items: CborValue[] = [];
      for (let i = 0; i < n; i++) items.push(decodeItem(s));
      return items;
    }
    case 5: { // map
      const n = Number(length);
      const entries: { keyBytes: Uint8Array; key: CborValue; val: CborValue }[] = [];
      for (let i = 0; i < n; i++) {
        const before = s.pos;
        const key = decodeItem(s);
        const keyBytes = s.bytes.slice(before, s.pos);
        const val = decodeItem(s);
        entries.push({ keyBytes, key, val });
      }
      // verify canonical key order
      for (let i = 1; i < entries.length; i++) {
        if (bytewiseCompare(entries[i - 1]!.keyBytes, entries[i]!.keyBytes) >= 0) {
          throw new Error('cbor: map keys not in canonical order');
        }
      }
      const out: { [k: string]: CborValue } = {};
      for (const e of entries) {
        if (typeof e.key !== 'string') {
          throw new Error('cbor: only string-keyed maps are supported by decoder');
        }
        out[e.key] = e.val;
      }
      return out;
    }
    case 7: {
      if (length === 20n) return false;
      if (length === 21n) return true;
      if (length === 22n) return null;
      throw new Error(`cbor: unsupported simple value ${length}`);
    }
    default:
      throw new Error(`cbor: unsupported major type ${majorType}`);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function readBytes(s: DecState, n: number): Uint8Array {
  if (s.pos + n > s.bytes.length) throw new Error('cbor: truncated');
  const out = s.bytes.slice(s.pos, s.pos + n);
  s.pos += n;
  return out;
}

function bytewiseCompare(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = a[i]! - b[i]!;
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}
