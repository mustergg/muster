/**
 * Web manifest builder + transport (R25 / Phase 2).
 *
 * Builds signed community manifests, computes the canonical manifestId,
 * and ships them over the WebSocket transport. Reverse of
 * apps/relay/src/manifestHandler.ts.
 *
 * Behind the VITE_TWO_LAYER feature flag.
 */

import {
  encodeCanonical,
  decodeCanonical,
  sha256,
  sign as signBytes,
  toBase64,
  toHex,
} from '@muster/crypto';
import {
  manifestToCborMap,
  manifestToUnsignedCborMap,
  manifestFromCborMap,
  type CommunityManifest,
  type ManifestAdmin,
  type ManifestChannel,
  MANIFEST_V,
} from '@muster/protocol';

export interface BuildGenesisInput {
  ownerPubkey: Uint8Array;
  ownerPrivkey: Uint8Array;
  admins?: ManifestAdmin[];
  channels: ManifestChannel[];
  memberPubkeys: Uint8Array[];
}

export interface BuildNextInput {
  previous: CommunityManifest;
  /** Raw canonical CBOR of the previous manifest (with sig). */
  previousCbor: Uint8Array;
  ownerPrivkey: Uint8Array;
  /** New admin roster. Pass the full roster — not a delta. */
  admins: ManifestAdmin[];
  /** New channel list. Pass the full list — not a delta. */
  channels: ManifestChannel[];
  /** New member list. Pass the full list — not a delta. */
  memberPubkeys: Uint8Array[];
}

export interface BuiltManifest {
  manifest: CommunityManifest;
  manifestId: Uint8Array;
  cborBytes: Uint8Array;
}

/**
 * Build a genesis (version-0) manifest. The communityId is derived as
 * H(canonicalCBOR(manifest \ sig + communityId=zeros)) — aligned with
 * the spec note that communityId = H(canonicalCBOR(manifestV0)).
 */
export async function buildGenesisManifest(input: BuildGenesisInput): Promise<BuiltManifest> {
  const {
    ownerPubkey, ownerPrivkey,
    admins = [],
    channels, memberPubkeys,
  } = input;

  const memberListHash = memberListDigest(memberPubkeys);
  const ts = Date.now();

  // Seed a manifest with a zeroed communityId so we can derive the real
  // one deterministically.
  const seed: Omit<CommunityManifest, 'sig' | 'communityId'> & { communityId: Uint8Array } = {
    v: MANIFEST_V,
    communityId: new Uint8Array(32),
    version: 0,
    owner: ownerPubkey,
    admins: sortAdmins(admins),
    channels: sortChannels(channels),
    memberListHash,
    ts,
    prevManifestHash: null,
  };

  // communityId = H(canonicalCBOR(seed))  — unsigned form with zero id
  const idSeedBytes = encodeCanonical(
    manifestToUnsignedCborMap(seed) as any,
  );
  const communityId = sha256(idSeedBytes);

  // Now rebuild with the real communityId and sign.
  const unsigned = { ...seed, communityId };
  const unsignedBytes = encodeCanonical(manifestToUnsignedCborMap(unsigned) as any);
  const sig = await signBytes(unsignedBytes, ownerPrivkey);
  const manifest: CommunityManifest = { ...unsigned, sig };
  const cborBytes = encodeCanonical(manifestToCborMap(manifest) as any);
  const manifestId = sha256(cborBytes);

  return { manifest, manifestId, cborBytes };
}

/**
 * Build the next version after `previous`. Owner is immutable (enforced
 * by the relay in Phase 2). Bumps `version`, chains `prevManifestHash`.
 */
export async function buildNextManifest(input: BuildNextInput): Promise<BuiltManifest> {
  const { previous, previousCbor, ownerPrivkey, admins, channels, memberPubkeys } = input;

  const unsigned = {
    v: MANIFEST_V as 1,
    communityId: previous.communityId,
    version: previous.version + 1,
    owner: previous.owner,
    admins: sortAdmins(admins),
    channels: sortChannels(channels),
    memberListHash: memberListDigest(memberPubkeys),
    ts: Date.now(),
    prevManifestHash: sha256(previousCbor),
  };

  const unsignedBytes = encodeCanonical(manifestToUnsignedCborMap(unsigned) as any);
  const sig = await signBytes(unsignedBytes, ownerPrivkey);
  const manifest: CommunityManifest = { ...unsigned, sig };
  const cborBytes = encodeCanonical(manifestToCborMap(manifest) as any);
  const manifestId = sha256(cborBytes);

  return { manifest, manifestId, cborBytes };
}

// ─── Transport helpers ─────────────────────────────────────────────────────

export interface ManifestTransport {
  send: (msg: any) => void;
  isConnected: boolean;
}

export function publishManifest(transport: ManifestTransport, built: BuiltManifest): void {
  if (!transport.isConnected) throw new Error('manifest: transport not connected');
  transport.send({
    type: 'MANIFEST_PUBLISH',
    payload: { cbor: toBase64(built.cborBytes) },
    timestamp: Date.now(),
  });
}

export function requestManifest(
  transport: ManifestTransport,
  communityId: Uint8Array,
  version?: number,
): void {
  if (!transport.isConnected) throw new Error('manifest: transport not connected');
  const payload: Record<string, unknown> = { communityId: toHex(communityId) };
  if (typeof version === 'number') payload.version = version;
  transport.send({
    type: 'MANIFEST_REQUEST',
    payload,
    timestamp: Date.now(),
  });
}

/**
 * Decode a MANIFEST_PUBLISH / MANIFEST_RESPONSE payload. Returns the
 * manifest and its canonical id. Throws on malformed CBOR.
 */
export function decodeManifestWirePayload(cborB64: string): BuiltManifest {
  const cborBytes = base64Decode(cborB64);
  const map = decodeCanonical(cborBytes) as Record<string, unknown>;
  const manifest = manifestFromCborMap(map);
  const manifestId = sha256(cborBytes);
  return { manifest, manifestId, cborBytes };
}

// ─── Internals ─────────────────────────────────────────────────────────────

function memberListDigest(pubkeys: Uint8Array[]): Uint8Array {
  const sorted = pubkeys.slice().sort(compareBytes);
  return sha256(encodeCanonical(sorted as any));
}

function sortAdmins(admins: ManifestAdmin[]): ManifestAdmin[] {
  return admins.slice().sort((a, b) => compareBytes(a.pubkey, b.pubkey));
}

function sortChannels(channels: ManifestChannel[]): ManifestChannel[] {
  return channels.slice().sort((a, b) => compareBytes(a.id, b.id));
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    if (av !== bv) return av - bv;
  }
  return a.length - b.length;
}

function base64Decode(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
