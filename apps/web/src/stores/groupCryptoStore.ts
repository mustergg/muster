/**
 * Group Crypto Store — R22
 *
 * Client-side group key management for E2E encrypted channels.
 *
 * Uses the same ECDH primitives as R14 (DM E2E):
 *   Ed25519 → X25519 conversion → ECDH shared secret → AES-256-GCM
 *
 * Group key flow:
 *   1. Owner generates random 256-bit group key
 *   2. For each member: encrypt group key via ECDH (owner's X25519 + member's X25519)
 *   3. Send encrypted bundles to relay
 *   4. Members decrypt group key with their own X25519 private key
 *   5. Messages encrypted/decrypted with group key via AES-256-GCM
 */

import { create } from 'zustand';
import { useNetworkStore } from './networkStore';
import type { TransportMessage } from '@muster/transport';
import { edPrivateToX25519, edPublicToX25519, computeSharedSecret, deriveMessageKey } from '@muster/crypto/e2e';

// =================================================================
// Types
// =================================================================

interface GroupKey {
  epoch: number;
  key: Uint8Array; // 32 bytes, decrypted AES key
  createdAt: number;
}

interface ChannelCrypto {
  channelId: string;
  enabled: boolean;
  historyAccess: string;
  currentEpoch: number;
  keys: Map<number, GroupKey>; // epoch → decrypted key
}

interface GroupCryptoState {
  /** Per-channel crypto state. */
  channels: Map<string, ChannelCrypto>;
  /** Whether crypto module is ready. */
  ready: boolean;

  /** Request group keys for a channel from relay. */
  requestKeys: (channelId: string) => void;
  /** Generate and distribute a new group key (owner/admin). */
  setupEncryption: (channelId: string, communityId: string, memberPublicKeys: string[], historyAccess?: string) => Promise<void>;
  /** Rotate the group key (after kick). */
  rotateKey: (channelId: string, remainingMemberKeys: string[], reason?: string) => Promise<void>;
  /** Re-wrap the CURRENT key (no new epoch) for the given members — used to
   *  hand the existing key to members who joined while the owner was away. */
  redistributeKey: (channelId: string, memberKeys: string[]) => Promise<void>;
  /** Encrypt a message for a channel. Returns encrypted payload or null if not encrypted. */
  encrypt: (channelId: string, plaintext: string) => Promise<{ ciphertext: string; nonce: string; epoch: number } | null>;
  /** Decrypt a message from a channel. Returns plaintext or null if can't decrypt. */
  decrypt: (channelId: string, ciphertext: string, nonce: string, epoch: number) => Promise<string | null>;
  /**
   * R25 — Phase 4. Wrap a per-blob AES-256 key under the channel key so a
   * file/voice envelope can carry it. Uses the channel group key when E2E
   * is enabled, otherwise a deterministic per-channel fallback so the blob
   * stays decryptable by anyone in the channel during rollout.
   */
  wrapBlobKey: (channelId: string, blobKey: Uint8Array) => Promise<{ wrap: Uint8Array; nonce: Uint8Array; epoch: number }>;
  /** R25 — Phase 4. Inverse of wrapBlobKey. Returns the raw 32-byte blob key. */
  unwrapBlobKey: (channelId: string, wrap: Uint8Array, nonce: Uint8Array, epoch: number) => Promise<Uint8Array>;
  /** Check if a channel has E2E enabled. */
  isEncrypted: (channelId: string) => boolean;
  /** Init message listener. */
  init: () => () => void;
}

// =================================================================
// Crypto helpers (browser Web Crypto API)
// =================================================================

/** Generate a random 256-bit key. */
function generateGroupKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** Generate a random 12-byte nonce. */
function generateNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12));
}

/** Hex encode. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hex decode. */
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/** Derive a shared AES-GCM key between two Ed25519 identities via real X25519
 *  ECDH + HKDF-SHA256 (same primitives as DM E2E). ECDH is symmetric, so the
 *  distributor (myPriv, theirPub) and the recipient (theirPriv, myPub) derive
 *  the identical secret — which the previous SHA-256(concat) placeholder did
 *  NOT, so group keys never reached members. `privateKeyHex` is the caller's
 *  Ed25519 seed; `publicKeyHex` is the peer's Ed25519 public key. */
async function deriveSharedKey(privateKeyHex: string, publicKeyHex: string): Promise<CryptoKey> {
  const xPriv = edPrivateToX25519(fromHex(privateKeyHex));
  const xPub = edPublicToX25519(fromHex(publicKeyHex));
  const secret = computeSharedSecret(xPriv, xPub);
  const keyBytes = deriveMessageKey(secret); // HKDF-SHA256 → 32 bytes
  const buf = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
  return crypto.subtle.importKey('raw', buf, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Encrypt data with AES-256-GCM. */
async function aesEncrypt(key: CryptoKey, plaintext: Uint8Array, nonce: Uint8Array): Promise<Uint8Array> {
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer }, key, plaintext.buffer as ArrayBuffer);
  return new Uint8Array(ciphertext);
}

/** Decrypt data with AES-256-GCM. */
async function aesDecrypt(key: CryptoKey, ciphertext: Uint8Array, nonce: Uint8Array): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer }, key, ciphertext.buffer as ArrayBuffer);
  return new Uint8Array(plaintext);
}

/** Import a raw 32-byte key as AES-GCM CryptoKey. */
async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawKey.buffer as ArrayBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * R25 — Phase 4. Deterministic per-channel fallback key, used to wrap blob
 * keys when no group key has been distributed yet. Anyone in the channel
 * derives the same value, so file/voice blobs stay openable during rollout
 * even before E2E is enabled. Once a real group key exists, wrapBlobKey
 * prefers it (epoch > 0) and this is no longer used for new uploads.
 */
async function deterministicChannelKey(channelId: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const h = await crypto.subtle.digest('SHA-256', enc.encode(`muster-blob-fallback:${channelId}`));
  return new Uint8Array(h);
}

/** Encrypt a group key for a specific recipient using simple shared secret. */
async function encryptGroupKeyForRecipient(
  groupKey: Uint8Array,
  myPrivateKeyHex: string,
  recipientPublicKeyHex: string,
): Promise<{ encryptedKey: string; nonce: string }> {
  const sharedKey = await deriveSharedKey(myPrivateKeyHex, recipientPublicKeyHex);
  const nonce = generateNonce();
  const encrypted = await aesEncrypt(sharedKey, groupKey, nonce);
  return { encryptedKey: toHex(encrypted), nonce: toHex(nonce) };
}

/** Decrypt a group key received from a distributor. */
async function decryptGroupKey(
  encryptedKeyHex: string,
  nonceHex: string,
  myPrivateKeyHex: string,
  distributorPublicKeyHex: string,
): Promise<Uint8Array> {
  const sharedKey = await deriveSharedKey(myPrivateKeyHex, distributorPublicKeyHex);
  const decrypted = await aesDecrypt(sharedKey, fromHex(encryptedKeyHex), fromHex(nonceHex));
  return decrypted;
}

// =================================================================
// Persistence — keep decrypted group keys across sessions, per account, so a
// reconnect after time away doesn't lose them (which previously left messages
// stuck as 🔒, or worse, made the owner regenerate the key and orphan history).
// =================================================================

function persistChannels(channels: Map<string, ChannelCrypto>): void {
  const myKey = useNetworkStore.getState().publicKey;
  if (!myKey) return;
  try {
    const arr = [...channels.values()].map((ch) => ({
      channelId: ch.channelId, enabled: ch.enabled, historyAccess: ch.historyAccess, currentEpoch: ch.currentEpoch,
      keys: [...ch.keys.values()].map((k) => ({ epoch: k.epoch, key: toHex(k.key), createdAt: k.createdAt })),
    }));
    localStorage.setItem(`muster-group-keys:${myKey}`, JSON.stringify(arr));
  } catch { /* ignore */ }
}

function loadPersistedChannels(): Map<string, ChannelCrypto> {
  const map = new Map<string, ChannelCrypto>();
  const myKey = useNetworkStore.getState().publicKey;
  if (!myKey) return map;
  try {
    const raw = localStorage.getItem(`muster-group-keys:${myKey}`);
    if (!raw) return map;
    for (const ch of JSON.parse(raw) as any[]) {
      const keys = new Map<number, GroupKey>();
      for (const k of ch.keys) keys.set(k.epoch, { epoch: k.epoch, key: fromHex(k.key), createdAt: k.createdAt });
      map.set(ch.channelId, { channelId: ch.channelId, enabled: ch.enabled, historyAccess: ch.historyAccess, currentEpoch: ch.currentEpoch, keys });
    }
  } catch { /* ignore */ }
  return map;
}

// =================================================================
// Store
// =================================================================

export const useGroupCryptoStore = create<GroupCryptoState>((set, get) => ({
  channels: new Map(),
  ready: true,

  requestKeys: (channelId: string) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'GROUP_KEY_REQUEST', payload: { channelId }, timestamp: Date.now() });
  },

  setupEncryption: async (channelId, communityId, memberPublicKeys, historyAccess = 'from_join') => {
    const { transport, publicKey } = useNetworkStore.getState();
    if (!transport?.isConnected) return;

    const auth = (await import('./authStore.js')).useAuthStore.getState();
    const myPrivateKeyHex = auth.publicKeyHex ? toHex(auth._keypair?.privateKey || new Uint8Array(32)) : '';

    // Generate new group key
    const groupKey = generateGroupKey();
    const epoch = 1;

    // Encrypt for each member
    const bundles: Array<{ recipientPublicKey: string; encryptedKey: string; nonce: string }> = [];
    for (const memberPubKey of memberPublicKeys) {
      const { encryptedKey, nonce } = await encryptGroupKeyForRecipient(groupKey, myPrivateKeyHex, memberPubKey);
      bundles.push({ recipientPublicKey: memberPubKey, encryptedKey, nonce });
    }

    // Set config on relay
    transport.send({
      type: 'GROUP_CRYPTO_CONFIG',
      payload: { channelId, communityId, enabled: true, historyAccess },
      timestamp: Date.now(),
    });

    // Distribute keys
    transport.send({
      type: 'GROUP_KEY_DISTRIBUTE',
      payload: { channelId, epoch, bundles, distributorPublicKey: publicKey },
      timestamp: Date.now(),
    });

    // Store locally
    const channelCrypto: ChannelCrypto = {
      channelId,
      enabled: true,
      historyAccess,
      currentEpoch: epoch,
      keys: new Map([[epoch, { epoch, key: groupKey, createdAt: Date.now() }]]),
    };

    set((state) => {
      const channels = new Map(state.channels);
      channels.set(channelId, channelCrypto);
      return { channels };
    });
    persistChannels(get().channels);

    console.log(`[group-crypto] Encryption setup for channel ${channelId.slice(0, 12)}: ${bundles.length} members, history=${historyAccess}`);
  },

  rotateKey: async (channelId, remainingMemberKeys, reason = 'manual') => {
    const { transport, publicKey } = useNetworkStore.getState();
    if (!transport?.isConnected) return;

    const auth = (await import('./authStore.js')).useAuthStore.getState();
    const myPrivateKeyHex = auth.publicKeyHex ? toHex(auth._keypair?.privateKey || new Uint8Array(32)) : '';

    const newGroupKey = generateGroupKey();

    const bundles: Array<{ recipientPublicKey: string; encryptedKey: string; nonce: string }> = [];
    for (const memberPubKey of remainingMemberKeys) {
      const { encryptedKey, nonce } = await encryptGroupKeyForRecipient(newGroupKey, myPrivateKeyHex, memberPubKey);
      bundles.push({ recipientPublicKey: memberPubKey, encryptedKey, nonce });
    }

    transport.send({
      type: 'GROUP_KEY_ROTATE',
      payload: { channelId, reason, bundles, distributorPublicKey: publicKey },
      timestamp: Date.now(),
    });

    // Update local store with new epoch (relay will confirm with epoch number)
    const existing = get().channels.get(channelId);
    const newEpoch = (existing?.currentEpoch || 0) + 1;

    set((state) => {
      const channels = new Map(state.channels);
      const ch = channels.get(channelId) || { channelId, enabled: true, historyAccess: 'from_join', currentEpoch: 0, keys: new Map() };
      ch.currentEpoch = newEpoch;
      ch.keys.set(newEpoch, { epoch: newEpoch, key: newGroupKey, createdAt: Date.now() });
      channels.set(channelId, ch);
      return { channels };
    });
    persistChannels(get().channels);

    console.log(`[group-crypto] Key rotated for ${channelId.slice(0, 12)}: epoch ${newEpoch}, reason: ${reason}`);
  },

  redistributeKey: async (channelId, memberKeys) => {
    const { transport, publicKey } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    const ch = get().channels.get(channelId);
    if (!ch) return; // not set up — caller should setupEncryption instead
    const current = ch.keys.get(ch.currentEpoch);
    if (!current) return;

    const auth = (await import('./authStore.js')).useAuthStore.getState();
    const myPrivateKeyHex = auth.publicKeyHex ? toHex(auth._keypair?.privateKey || new Uint8Array(32)) : '';

    const bundles: Array<{ recipientPublicKey: string; encryptedKey: string; nonce: string }> = [];
    for (const memberPubKey of memberKeys) {
      const { encryptedKey, nonce } = await encryptGroupKeyForRecipient(current.key, myPrivateKeyHex, memberPubKey);
      bundles.push({ recipientPublicKey: memberPubKey, encryptedKey, nonce });
    }
    // Same epoch — just (re)deliver the existing key to everyone (incl. members
    // who joined while we were offline). No rotation, so no churn.
    transport.send({
      type: 'GROUP_KEY_DISTRIBUTE',
      payload: { channelId, epoch: ch.currentEpoch, bundles, distributorPublicKey: publicKey },
      timestamp: Date.now(),
    });
    console.log(`[group-crypto] Key redistributed for ${channelId.slice(0, 12)}: epoch ${ch.currentEpoch}, ${bundles.length} members`);
  },

  encrypt: async (channelId, plaintext) => {
    const ch = get().channels.get(channelId);
    if (!ch || !ch.enabled || ch.keys.size === 0) return null;

    const currentKey = ch.keys.get(ch.currentEpoch);
    if (!currentKey) return null;

    try {
      const aesKey = await importAesKey(currentKey.key);
      const nonce = generateNonce();
      const encoder = new TextEncoder();
      const encrypted = await aesEncrypt(aesKey, encoder.encode(plaintext), nonce);
      return {
        ciphertext: toHex(encrypted),
        nonce: toHex(nonce),
        epoch: ch.currentEpoch,
      };
    } catch (err) {
      console.error('[group-crypto] Encrypt failed:', err);
      return null;
    }
  },

  decrypt: async (channelId, ciphertext, nonce, epoch) => {
    const ch = get().channels.get(channelId);
    if (!ch || !ch.enabled) return null;

    const key = ch.keys.get(epoch);
    if (!key) {
      console.warn(`[group-crypto] No key for epoch ${epoch} in channel ${channelId.slice(0, 12)}`);
      return null;
    }

    try {
      const aesKey = await importAesKey(key.key);
      const decrypted = await aesDecrypt(aesKey, fromHex(ciphertext), fromHex(nonce));
      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (err) {
      console.error('[group-crypto] Decrypt failed:', err);
      return null;
    }
  },

  wrapBlobKey: async (channelId, blobKey) => {
    const ch = get().channels.get(channelId);
    let raw: Uint8Array;
    let epoch: number;
    const cur = ch && ch.enabled && ch.keys.size > 0 ? ch.keys.get(ch.currentEpoch) : undefined;
    if (cur) {
      raw = cur.key;
      epoch = ch!.currentEpoch;
    } else {
      raw = await deterministicChannelKey(channelId);
      epoch = 0;
    }
    const aesKey = await importAesKey(raw);
    const nonce = generateNonce();
    const wrap = await aesEncrypt(aesKey, blobKey, nonce);
    return { wrap, nonce, epoch };
  },

  unwrapBlobKey: async (channelId, wrap, nonce, epoch) => {
    const ch = get().channels.get(channelId);
    let raw: Uint8Array | null = null;
    if (epoch > 0 && ch) {
      const k = ch.keys.get(epoch);
      if (k) raw = k.key;
    }
    if (!raw) raw = await deterministicChannelKey(channelId);
    const aesKey = await importAesKey(raw);
    return await aesDecrypt(aesKey, wrap, nonce);
  },

  isEncrypted: (channelId) => {
    const ch = get().channels.get(channelId);
    return ch?.enabled || false;
  },

  init: () => {
    const network = useNetworkStore.getState();

    // Restore persisted group keys for this account so we can decrypt history
    // immediately on reconnect (before any GROUP_KEY_RESPONSE round-trip).
    const persisted = loadPersistedChannels();
    if (persisted.size > 0) {
      set((state) => {
        const channels = new Map(state.channels);
        for (const [id, ch] of persisted) if (!channels.has(id)) channels.set(id, ch);
        return { channels };
      });
    }

    const unsubscribe = network.onMessage(async (msg: TransportMessage) => {
      if (msg.type === 'GROUP_KEY_RESPONSE') {
        const p = msg.payload as any;
        const { channelId, config, epochs } = p;

        if (!config?.enabled || !epochs?.length) return;

        // Decrypt each epoch's key
        const auth = (await import('./authStore.js')).useAuthStore.getState();
        const myPrivateKeyHex = auth.publicKeyHex ? toHex(auth._keypair?.privateKey || new Uint8Array(32)) : '';

        const keys = new Map<number, GroupKey>();
        for (const ep of epochs) {
          try {
            const decryptedKey = await decryptGroupKey(ep.encryptedKey, ep.nonce, myPrivateKeyHex, ep.distributorPublicKey);
            keys.set(ep.epoch, { epoch: ep.epoch, key: decryptedKey, createdAt: ep.createdAt });
          } catch (err) {
            console.error(`[group-crypto] Failed to decrypt epoch ${ep.epoch}:`, err);
          }
        }

        const channelCrypto: ChannelCrypto = {
          channelId,
          enabled: true,
          historyAccess: config.historyAccess,
          currentEpoch: config.currentEpoch,
          keys,
        };

        set((state) => {
          const channels = new Map(state.channels);
          // Merge: keep any locally-held epoch keys, add the recovered ones.
          const existing = channels.get(channelId);
          if (existing) for (const [ep, k] of existing.keys) if (!keys.has(ep)) keys.set(ep, k);
          channels.set(channelId, channelCrypto);
          return { channels };
        });
        persistChannels(get().channels);

        console.log(`[group-crypto] Loaded ${keys.size} key epochs for channel ${channelId.slice(0, 12)}`);
      }

      if (msg.type === 'GROUP_KEY_ROTATED') {
        const p = msg.payload as any;
        const { channelId, epoch, encryptedKey, nonce, distributorPublicKey } = p;

        try {
          const auth = (await import('./authStore.js')).useAuthStore.getState();
          const myPrivateKeyHex = auth.publicKeyHex ? toHex(auth._keypair?.privateKey || new Uint8Array(32)) : '';

          const decryptedKey = await decryptGroupKey(encryptedKey, nonce, myPrivateKeyHex, distributorPublicKey);

          set((state) => {
            const channels = new Map(state.channels);
            const ch = channels.get(channelId) || { channelId, enabled: true, historyAccess: 'from_join', currentEpoch: 0, keys: new Map() };
            ch.currentEpoch = epoch;
            ch.keys.set(epoch, { epoch, key: decryptedKey, createdAt: Date.now() });
            channels.set(channelId, ch);
            return { channels };
          });
          persistChannels(get().channels);

          console.log(`[group-crypto] Key rotated for ${channelId.slice(0, 12)}: epoch ${epoch}`);
        } catch (err) {
          console.error('[group-crypto] Failed to decrypt rotated key:', err);
        }
      }
    });

    return unsubscribe;
  },
}));

(window as any).__groupCrypto = useGroupCryptoStore;
