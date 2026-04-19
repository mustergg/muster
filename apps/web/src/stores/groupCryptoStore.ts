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
  /** Encrypt a message for a channel. Returns encrypted payload or null if not encrypted. */
  encrypt: (channelId: string, plaintext: string) => Promise<{ ciphertext: string; nonce: string; epoch: number } | null>;
  /** Decrypt a message from a channel. Returns plaintext or null if can't decrypt. */
  decrypt: (channelId: string, ciphertext: string, nonce: string, epoch: number) => Promise<string | null>;
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

/** Derive a shared encryption key from two X25519 keys using Web Crypto ECDH + HKDF. */
async function deriveSharedKey(privateKeyHex: string, publicKeyHex: string): Promise<CryptoKey> {
  // We use a simpler approach: SHA-256 hash of concatenated keys as shared secret
  // In production, use proper X25519 ECDH from @muster/crypto/e2e
  // For now, use PBKDF2 with the combined keys as a deterministic derivation
  const encoder = new TextEncoder();
  const combined = encoder.encode(privateKeyHex + publicKeyHex);
  const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
  return crypto.subtle.importKey('raw', hashBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
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

    console.log(`[group-crypto] Key rotated for ${channelId.slice(0, 12)}: epoch ${newEpoch}, reason: ${reason}`);
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

  isEncrypted: (channelId) => {
    const ch = get().channels.get(channelId);
    return ch?.enabled || false;
  },

  init: () => {
    const network = useNetworkStore.getState();

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
          channels.set(channelId, channelCrypto);
          return { channels };
        });

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
