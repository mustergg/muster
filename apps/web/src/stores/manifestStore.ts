/**
 * Manifest Store — R25 / Phase 2.
 *
 * Holds the latest signed manifest known to the client per community,
 * plus the raw CBOR (needed to derive `prevManifestHash` when publishing
 * the next version).
 *
 * Listens for MANIFEST_PUBLISH + MANIFEST_RESPONSE frames on the network
 * store. Gated behind VITE_TWO_LAYER=1 at the call-site.
 */

import { create } from 'zustand';
import type { TransportMessage } from '@muster/transport';
import type { CommunityManifest, ManifestAdmin, ManifestChannel } from '@muster/protocol';
import { toHex } from '@muster/crypto';
import { useNetworkStore } from './networkStore';
import {
  buildGenesisManifest,
  buildNextManifest,
  decodeManifestWirePayload,
  publishManifest,
  requestManifest,
  type BuiltManifest,
} from '../lib/manifest';

interface ManifestEntry {
  manifest: CommunityManifest;
  manifestId: Uint8Array;
  cborBytes: Uint8Array;
  receivedAt: number;
}

interface ManifestState {
  /** key = hex(communityId). Value = latest known manifest. */
  byCommunity: Record<string, ManifestEntry>;

  /** Lookup latest. Returns undefined if none cached. */
  getLatest: (communityIdHex: string) => ManifestEntry | undefined;

  /** Pull the latest (or a specific version) from the relay. Fire-and-forget. */
  fetchLatest: (communityIdHex: string, version?: number) => void;

  /**
   * Create the genesis manifest for a new community and publish it.
   * Returns the built manifest so the caller can render its ids.
   */
  createCommunity: (params: {
    ownerPubkey: Uint8Array;
    ownerPrivkey: Uint8Array;
    admins?: ManifestAdmin[];
    channels: ManifestChannel[];
    memberPubkeys: Uint8Array[];
  }) => Promise<BuiltManifest>;

  /**
   * Publish the next version of an existing manifest. `previousHex` must
   * already be in the store (via fetchLatest or a prior publish).
   */
  updateCommunity: (params: {
    communityIdHex: string;
    ownerPrivkey: Uint8Array;
    admins: ManifestAdmin[];
    channels: ManifestChannel[];
    memberPubkeys: Uint8Array[];
  }) => Promise<BuiltManifest>;

  /** Ingest a manifest received on the wire (or built locally). */
  ingest: (built: BuiltManifest) => void;

  init: () => () => void;
}

export const useManifestStore = create<ManifestState>((set, get) => ({
  byCommunity: {},

  getLatest: (id) => get().byCommunity[id],

  fetchLatest: (id, version) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    const bytes = hexToBytes(id);
    if (!bytes) return;
    requestManifest(
      { send: (m) => transport.send(m), isConnected: transport.isConnected },
      bytes,
      version,
    );
  },

  createCommunity: async (p) => {
    const built = await buildGenesisManifest(p);
    const { transport } = useNetworkStore.getState();
    if (transport?.isConnected) {
      publishManifest(
        { send: (m) => transport.send(m), isConnected: transport.isConnected },
        built,
      );
    }
    get().ingest(built);
    return built;
  },

  updateCommunity: async (p) => {
    const existing = get().byCommunity[p.communityIdHex];
    if (!existing) {
      throw new Error(`manifest: no cached manifest for ${p.communityIdHex.slice(0, 12)} — call fetchLatest first`);
    }
    const built = await buildNextManifest({
      previous: existing.manifest,
      previousCbor: existing.cborBytes,
      ownerPrivkey: p.ownerPrivkey,
      admins: p.admins,
      channels: p.channels,
      memberPubkeys: p.memberPubkeys,
    });
    const { transport } = useNetworkStore.getState();
    if (transport?.isConnected) {
      publishManifest(
        { send: (m) => transport.send(m), isConnected: transport.isConnected },
        built,
      );
    }
    get().ingest(built);
    return built;
  },

  ingest: (built) => {
    const key = toHex(built.manifest.communityId);
    set((state) => {
      const prev = state.byCommunity[key];
      // Keep the higher version — the wire can deliver older manifests
      // during catch-up.
      if (prev && prev.manifest.version >= built.manifest.version) return state;
      return {
        byCommunity: {
          ...state.byCommunity,
          [key]: {
            manifest: built.manifest,
            manifestId: built.manifestId,
            cborBytes: built.cborBytes,
            receivedAt: Date.now(),
          },
        },
      };
    });
  },

  init: () => {
    const network = useNetworkStore.getState();
    const unsubscribe = network.onMessage((msg: TransportMessage) => {
      if (msg.type === 'MANIFEST_PUBLISH' || msg.type === 'MANIFEST_RESPONSE') {
        const p = (msg as any).payload;
        if (p?.notFound) return;
        const cborB64 = p?.cbor;
        if (typeof cborB64 !== 'string') return;
        try {
          const built = decodeManifestWirePayload(cborB64);
          get().ingest(built);
        } catch (err) {
          console.warn('[manifest] ingest failed:', err);
        }
      }
    });
    return unsubscribe;
  },
}));

function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}

(window as any).__manifest = useManifestStore;
