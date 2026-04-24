/**
 * twoLayerMigration — R25 / Phase 1.
 *
 * One-shot, idempotent shim that imports rows from the legacy `messages`
 * table into the new `envelopes` table so the two-layer code path has
 * something to read on day-1.
 *
 * Important caveats — these envelopes are NOT spec-conformant:
 *   - sig is 64 zero bytes (legacy rows were never signed in canonical
 *     CBOR form). The relay's send-path verifier will reject anything
 *     with a zero sig; only history reads are exposed.
 *   - communityId is derived from the channel string (sha256("legacy-
 *     community:" + channel[:4])) because legacy `messages` rows have
 *     no community linkage. Phase 2 (signed manifests) will re-key.
 *   - body is wrapped as a sentinel inline ciphertext = literal UTF-8
 *     bytes of the legacy plaintext, with a zero nonce + epoch=0. The
 *     relay never decrypts so this is harmless; web-side decoders
 *     must skip when epoch===0 && nonce===zeros.
 *   - file messages (content starting with "__FILE__") are imported as
 *     `kind: 'file'` with the JSON metadata as the inline body. Their
 *     blob bytes stay in fileDB and will be re-piecified in Phase 4.
 *
 * Tracked by `PRAGMA user_version`: bumps to 1 once migration completes.
 * Re-running is a no-op.
 */

import type Database from 'better-sqlite3';
import { encodeCanonical, sha256 } from '@muster/crypto';
import { toCborMap, type Envelope } from '@muster/protocol';

const MIGRATION_VERSION = 1;
const ZERO12 = new Uint8Array(12);
const ZERO32 = new Uint8Array(32);
const ZERO64 = new Uint8Array(64);

interface LegacyRow {
  messageId: string;
  channel: string;
  content: string;
  senderPublicKey: string;
  senderUsername: string;
  timestamp: number;
  signature: string;
}

export interface MigrationResult {
  ran: boolean;
  imported: number;
  skipped: number;
  durationMs: number;
}

export function runTwoLayerMigration(db: Database.Database): MigrationResult {
  const t0 = Date.now();
  const current = (db.pragma('user_version', { simple: true }) as number) ?? 0;
  if (current >= MIGRATION_VERSION) {
    return { ran: false, imported: 0, skipped: 0, durationMs: 0 };
  }

  // Both target tables must already exist — EnvelopeDB/BlobDB constructors
  // create them. Caller must instantiate those before invoking.
  const envCount = (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='envelopes'").get() as { n: number }).n;
  if (envCount === 0) {
    throw new Error('twoLayerMigration: envelopes table missing — instantiate EnvelopeDB first');
  }

  const legacyCount = (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='messages'").get() as { n: number }).n;
  if (legacyCount === 0) {
    // Fresh install — nothing to migrate. Stamp the version and bail.
    db.pragma(`user_version = ${MIGRATION_VERSION}`);
    return { ran: true, imported: 0, skipped: 0, durationMs: Date.now() - t0 };
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO envelopes (
      envelopeId, communityId, channelId, senderPubkey, ts, kind,
      hasBlob, blobRoot, replyTo, edits, tombstones, cbor, receivedAt
    ) VALUES (
      @envelopeId, @communityId, @channelId, @senderPubkey, @ts, @kind,
      @hasBlob, @blobRoot, @replyTo, @edits, @tombstones, @cbor, @receivedAt
    )
  `);

  const enc = new TextEncoder();

  let imported = 0;
  let skipped = 0;

  const tx = db.transaction(() => {
    const rows = db.prepare('SELECT * FROM messages').all() as LegacyRow[];
    for (const r of rows) {
      try {
        const senderPubkey = hexToBytes(r.senderPublicKey);
        if (senderPubkey.length !== 32) {
          skipped++;
          continue;
        }
        const channelId = sha256(enc.encode(`channel:${r.channel}`));
        const communityId = sha256(enc.encode(`legacy-community:${r.channel.slice(0, 4)}`));
        const isFile = r.content.startsWith('__FILE__');
        const kind: 'text' | 'file' = isFile ? 'file' : 'text';
        const body = enc.encode(r.content);
        if (body.length > 4096) {
          // Too big for inline ciphertext slot. Phase 4 will re-piecify.
          skipped++;
          continue;
        }

        const env: Envelope = {
          v: 1,
          communityId,
          channelId,
          senderPubkey,
          ts: r.timestamp,
          kind,
          body: { inline: true, ciphertext: body, nonce: ZERO12, epoch: 0 },
          sig: ZERO64,
        };
        const cbor = encodeCanonical(toCborMap(env) as any);
        const envelopeId = sha256(cbor);

        const res = insert.run({
          envelopeId: Buffer.from(envelopeId),
          communityId: Buffer.from(communityId),
          channelId: Buffer.from(channelId),
          senderPubkey: Buffer.from(senderPubkey),
          ts: r.timestamp,
          kind,
          hasBlob: 0,
          blobRoot: null,
          replyTo: null,
          edits: null,
          tombstones: null,
          cbor: Buffer.from(cbor),
          receivedAt: Date.now(),
        });
        if (res.changes > 0) imported++;
        else skipped++;
      } catch {
        skipped++;
      }
    }
    db.pragma(`user_version = ${MIGRATION_VERSION}`);
  });

  tx();

  return { ran: true, imported, skipped, durationMs: Date.now() - t0 };
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) return new Uint8Array(0);
    out[i] = byte;
  }
  return out;
}

// Silence unused warning — exported for future migrations that need ZERO32.
void ZERO32;
