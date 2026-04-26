/**
 * Chat Store — R10 update
 *
 * Fixes from R9:
 * - BUG FIX: FILE_MESSAGE now persisted in IndexedDB (browserDB)
 *   File metadata stored as __FILE__JSON in the content field
 *   Reconstructed when loading from DB
 *
 * New:
 * - File messages survive channel switching and browser refresh
 */

import { create } from 'zustand';
import { useNetworkStore } from './networkStore';
import { useGroupCryptoStore } from './groupCryptoStore';
import { BrowserDB, type DBMessage } from '@muster/db';
import { sign as ed25519Sign, toHex, sha256, fromHex, decodeCanonical } from '@muster/crypto';
import type { TransportMessage } from '@muster/transport';
// R25 — Phase 1: two-layer envelope path (gated by VITE_TWO_LAYER=1).
import { buildEnvelope, sendBuiltEnvelope } from '../lib/envelope';
import { fromCborMap } from '@muster/protocol';

const encoder = new TextEncoder();
const FILE_PREFIX = '__FILE__';

// R25 — Phase 10. Envelope dual-write is always-on now. The
// VITE_TWO_LAYER flag was retired with Phase 10.
const TWO_LAYER_ENABLED = true;

async function signPayload(payload: string, privateKey: Uint8Array): Promise<string> {
  const sigBytes = await ed25519Sign(encoder.encode(payload), privateKey);
  return toHex(sigBytes);
}

function getPrivateKey(): Uint8Array | null {
  try {
    const authStore = (window as any).__authStore;
    if (authStore) return authStore.getState()._keypair?.privateKey ?? null;
    return null;
  } catch { return null; }
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Encode file metadata into content string for DB storage. */
function encodeFileContent(fileId: string, fileName: string, mimeType: string, fileSize: number, messageText: string): string {
  return FILE_PREFIX + JSON.stringify({ fileId, fileName, mimeType, fileSize, text: messageText });
}

/** Decode a DB content string — returns file fields if it's a file message, null otherwise. */
function decodeFileContent(content: string): { fileId: string; fileName: string; mimeType: string; fileSize: number; text: string } | null {
  if (!content.startsWith(FILE_PREFIX)) return null;
  try {
    return JSON.parse(content.slice(FILE_PREFIX.length));
  } catch {
    return null;
  }
}

export interface ChatMessage {
  messageId: string; channel: string; content: string;
  senderPublicKey: string; senderUsername: string; timestamp: number; isOwn: boolean;
  fileId?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
}

export interface PresenceUser { publicKey: string; username: string; status: string; }

interface ChatState {
  messages: Record<string, ChatMessage[]>;
  presence: Record<string, PresenceUser[]>;
  activeChannel: string | null;
  subscribe: (channels: string[]) => void;
  unsubscribe: (channels: string[]) => void;
  sendMessage: (channel: string, content: string) => void;
  deleteMessage: (channel: string, messageId: string) => void;
  setActiveChannel: (channelId: string | null) => void;
  clear: () => void;
  init: () => () => void;
}

const browserDB = new BrowserDB();

/** Convert a DB message to a ChatMessage, detecting file messages. */
function dbMsgToChatMsg(msg: DBMessage, myKey: string): ChatMessage {
  const fileData = decodeFileContent(msg.content);
  if (fileData) {
    return {
      messageId: msg.messageId, channel: msg.channel,
      content: fileData.text || '',
      senderPublicKey: msg.senderPublicKey, senderUsername: msg.senderUsername,
      timestamp: msg.timestamp, isOwn: msg.senderPublicKey === myKey,
      fileId: fileData.fileId, fileName: fileData.fileName,
      mimeType: fileData.mimeType, fileSize: fileData.fileSize,
    };
  }
  return {
    messageId: msg.messageId, channel: msg.channel, content: msg.content,
    senderPublicKey: msg.senderPublicKey, senderUsername: msg.senderUsername,
    timestamp: msg.timestamp, isOwn: msg.senderPublicKey === myKey,
  };
}

// ── R25 — Phase 1 envelope helpers ─────────────────────────────────────────

/** Map a legacy channel string id to a 32-byte canonical channelId. */
function channelIdBytes(channel: string): Uint8Array {
  return sha256(new TextEncoder().encode(`channel:${channel}`));
}

/** Same idea for community ids until Phase 2 wires real signed manifests. */
function communityIdBytesFromChannel(channel: string): Uint8Array {
  // Legacy data has no real community id. Derive a stable surrogate.
  return sha256(new TextEncoder().encode(`legacy-community:${channel.slice(0, 4)}`));
}

/**
 * Build + send an envelope for `content` on `channel`. Uses the channel's
 * group key when E2E is enabled; otherwise falls back to a sentinel "no-op"
 * key so the wire shape is exercised end-to-end during rollout.
 */
async function sendAsEnvelope(
  channel: string,
  content: string,
  senderPublicKeyHex: string,
  privateKey: Uint8Array,
): Promise<void> {
  const network = useNetworkStore.getState();
  if (!network.transport?.isConnected) return;

  const groupCrypto = useGroupCryptoStore.getState();
  const epoch = groupCrypto.channels.get(channel)?.currentEpoch ?? 0;

  const senderPubkey = fromHex(senderPublicKeyHex);

  const built = await buildEnvelope({
    communityId: communityIdBytesFromChannel(channel),
    channelId: channelIdBytes(channel),
    senderPubkey,
    senderPrivkey: privateKey,
    kind: 'text',
    payload: content,
    epoch,
    encryptBody: async (plaintext) => {
      // Prefer the channel's group key. If none, use a per-message random
      // key (still correct AES-GCM, just not group-decryptable). Recipients
      // without the key see ciphertext they can't open — fine for the
      // shadow path during rollout.
      const enc = await groupCrypto.encrypt(channel, new TextDecoder().decode(plaintext));
      if (enc) return { ciphertext: fromHex(enc.ciphertext), nonce: fromHex(enc.nonce) };
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const key = crypto.getRandomValues(new Uint8Array(32));
      const ck = await crypto.subtle.importKey('raw', key.buffer as ArrayBuffer, 'AES-GCM', false, ['encrypt']);
      const ct = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer }, ck, plaintext.buffer as ArrayBuffer),
      );
      return { ciphertext: ct, nonce };
    },
  });

  await sendBuiltEnvelope({
    send: (m) => network.transport!.send(m),
    isConnected: network.transport.isConnected,
  }, built);
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  presence: {},
  activeChannel: null,

  subscribe: (channelIds) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'SUBSCRIBE', payload: { channels: channelIds }, timestamp: Date.now() });

    const myKey = useNetworkStore.getState().publicKey;
    for (const channelId of channelIds) {
      browserDB.getMessages(channelId).then((dbMsgs) => {
        if (dbMsgs.length > 0) {
          set((state) => ({ messages: { ...state.messages, [channelId]: dbMsgs.map((m) => dbMsgToChatMsg(m, myKey)) } }));
        }
      });
      browserDB.getLatestTimestamp(channelId).then((since) => {
        transport.send({ type: 'SYNC_REQUEST', payload: { channel: channelId, since }, timestamp: Date.now() });
      });
    }
  },

  unsubscribe: (channelIds) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'UNSUBSCRIBE', payload: { channels: channelIds }, timestamp: Date.now() });
  },

  sendMessage: (channel, content) => {
    const network = useNetworkStore.getState();
    if (!network.transport?.isConnected) return;

    const messageId = uuid();
    const timestamp = Date.now();
    const payload = { channel, content, messageId, timestamp };
    const payloadStr = JSON.stringify(payload);

    const dbMsg: DBMessage = { messageId, channel, content, senderPublicKey: network.publicKey, senderUsername: network.username, timestamp, signature: '' };
    browserDB.addMessage(dbMsg);
    browserDB.setLastSyncTimestamp(channel, timestamp);

    set((state) => ({
      messages: { ...state.messages, [channel]: [...(state.messages[channel] || []), { messageId, channel, content, senderPublicKey: network.publicKey, senderUsername: network.username, timestamp, isOwn: true }] },
    }));

    const privateKey = getPrivateKey();
    if (privateKey) {
      signPayload(payloadStr, privateKey).then((signature) => {
        network.transport!.send({ type: 'PUBLISH', payload, timestamp, signature, senderPublicKey: network.publicKey });
      }).catch(() => {
        network.transport!.send({ type: 'PUBLISH', payload, timestamp, signature: '', senderPublicKey: network.publicKey });
      });
    } else {
      network.transport!.send({ type: 'PUBLISH', payload, timestamp, signature: '', senderPublicKey: network.publicKey });
    }

    // R25 — Phase 1: dual-write through the envelope path so the relay can
    // exercise verification + storage. Legacy PUBLISH stays the source of
    // truth until the migration cutover (Phase 10).
    if (TWO_LAYER_ENABLED && privateKey) {
      void sendAsEnvelope(channel, content, network.publicKey, privateKey).catch((err) => {
        console.warn('[chat] envelope dual-write failed:', err);
      });
    }
  },

  deleteMessage: (channel, messageId) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'DELETE_MESSAGE', payload: { channel, messageId }, timestamp: Date.now() });
  },

  setActiveChannel: (channelId) => set({ activeChannel: channelId }),
  clear: () => { browserDB.clearAll(); set({ messages: {}, presence: {}, activeChannel: null }); },

  init: () => {
    const network = useNetworkStore.getState();
    const myKey = network.publicKey;

    const unsubscribe = network.onMessage((msg: TransportMessage) => {
      switch (msg.type) {
        case 'MESSAGE': {
          const p = msg.payload as any;
          const chatMsg: ChatMessage = { messageId: p.messageId, channel: p.channel, content: p.content, senderPublicKey: p.senderPublicKey, senderUsername: p.senderUsername, timestamp: p.timestamp, isOwn: p.senderPublicKey === myKey };
          browserDB.addMessage({ messageId: p.messageId, channel: p.channel, content: p.content, senderPublicKey: p.senderPublicKey, senderUsername: p.senderUsername, timestamp: p.timestamp, signature: (msg as any).signature || '' });
          browserDB.setLastSyncTimestamp(p.channel, p.timestamp);
          set((state) => {
            const existing = state.messages[p.channel] || [];
            if (existing.some((m) => m.messageId === chatMsg.messageId)) return state;
            return { messages: { ...state.messages, [p.channel]: [...existing, chatMsg].sort((a, b) => a.timestamp - b.timestamp) } };
          });
          break;
        }

        // R9+R10: Handle file messages — now persisted in IndexedDB
        case 'FILE_MESSAGE': {
          const p = msg.payload as any;
          const chatMsg: ChatMessage = {
            messageId: p.messageId, channel: p.channel,
            content: p.messageText || '',
            senderPublicKey: p.senderPublicKey, senderUsername: p.senderUsername,
            timestamp: p.timestamp, isOwn: p.senderPublicKey === myKey,
            fileId: p.fileId, fileName: p.fileName, mimeType: p.mimeType, fileSize: p.size,
          };

          // BUG FIX: Persist file message in IndexedDB with encoded metadata
          const encodedContent = encodeFileContent(p.fileId, p.fileName, p.mimeType, p.size, p.messageText || '');
          browserDB.addMessage({
            messageId: p.messageId, channel: p.channel,
            content: encodedContent,
            senderPublicKey: p.senderPublicKey, senderUsername: p.senderUsername,
            timestamp: p.timestamp, signature: '',
          });
          browserDB.setLastSyncTimestamp(p.channel, p.timestamp);

          set((state) => {
            const existing = state.messages[p.channel] || [];
            if (existing.some((m) => m.messageId === chatMsg.messageId)) return state;
            return { messages: { ...state.messages, [p.channel]: [...existing, chatMsg].sort((a, b) => a.timestamp - b.timestamp) } };
          });
          break;
        }

        case 'SYNC_RESPONSE': {
          const p = msg.payload as any;
          const synced: any[] = p.messages || [];
          if (synced.length === 0) break;
          const dbMsgs: DBMessage[] = synced.map((m: any) => ({ messageId: m.messageId, channel: m.channel, content: m.content, senderPublicKey: m.senderPublicKey, senderUsername: m.senderUsername, timestamp: m.timestamp, signature: '' }));
          browserDB.addMessages(dbMsgs);
          const maxTs = Math.max(...synced.map((m: any) => m.timestamp));
          browserDB.setLastSyncTimestamp(p.channel, maxTs);
          const chatMsgs: ChatMessage[] = synced.map((m: any) => dbMsgToChatMsg(m as DBMessage, myKey));
          set((state) => {
            const existing = state.messages[p.channel] || [];
            const ids = new Set(existing.map((m) => m.messageId));
            const newMsgs = chatMsgs.filter((m) => !ids.has(m.messageId));
            if (newMsgs.length === 0) return state;
            return { messages: { ...state.messages, [p.channel]: [...existing, ...newMsgs].sort((a, b) => a.timestamp - b.timestamp) } };
          });
          break;
        }

        case 'MESSAGE_DELETED': {
          const p = msg.payload as any;
          set((state) => {
            const existing = state.messages[p.channel] || [];
            return { messages: { ...state.messages, [p.channel]: existing.filter((m) => m.messageId !== p.messageId) } };
          });
          break;
        }

        case 'PRESENCE': {
          const p = msg.payload as any;
          set((state) => ({ presence: { ...state.presence, [p.channel]: p.users || [] } }));
          break;
        }

        // R25 — Phase 1 shadow path. Cache the envelope so the next phase
        // can render straight from it. Doesn't yet replace 'MESSAGE'.
        case 'ENVELOPE': {
          if (!TWO_LAYER_ENABLED) break;
          const cborB64 = (msg as any).payload?.cbor;
          if (typeof cborB64 !== 'string') break;
          try {
            const bin = Uint8Array.from(atob(cborB64), (c) => c.charCodeAt(0));
            const map = decodeCanonical(bin) as Record<string, unknown>;
            const env = fromCborMap(map);
            const id = sha256(bin);
            void browserDB.addEnvelope({
              envelopeId: toHex(id),
              communityId: toHex(env.communityId),
              channelId: toHex(env.channelId),
              senderPubkey: toHex(env.senderPubkey),
              ts: env.ts,
              kind: env.kind,
              hasBlob: env.body.inline ? 0 : 1,
              blobRoot: env.body.inline ? undefined : toHex((env.body as any).blobRef.root),
              replyTo: env.replyTo ? toHex(env.replyTo) : undefined,
              edits: env.edits ? toHex(env.edits) : undefined,
              tombstones: env.tombstones ? toHex(env.tombstones) : undefined,
              cborB64,
              receivedAt: Date.now(),
              blobStatus: env.body.inline ? 'ready' : 'pending',
            });
          } catch (err) {
            console.warn('[chat] envelope cache failed:', err);
          }
          break;
        }
      }
    });

    return unsubscribe;
  },
}));

(window as any).__chat = useChatStore;
