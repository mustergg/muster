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
import { usePieceCacheStore } from './pieceCacheStore';
import { BrowserDB, type DBMessage } from '@muster/db';
import { sign as ed25519Sign, toHex, sha256, fromHex, decodeCanonical } from '@muster/crypto';
import type { TransportMessage } from '@muster/transport';
// R25 — Phase 1/4: two-layer envelope + blob path (always-on since Phase 10).
import { buildEnvelope, sendBuiltEnvelope } from '../lib/envelope';
import { fetchBlob } from '../lib/pieceFetcher';
import { fromCborMap, type BlobRef, type EnvelopeKind } from '@muster/protocol';

const encoder = new TextEncoder();
const FILE_PREFIX = '__FILE__';
// R25 — Phase 4: blob-backed attachment marker for DB persistence. The real
// bytes live in the piece store; this row just records how to re-fetch them.
const BLOB_PREFIX = '__BLOB__';

// R25 — Phase 10. Envelope dual-write is always-on now. The
// VITE_TWO_LAYER flag was retired with Phase 10.
const TWO_LAYER_ENABLED = true;

// E2E group encryption for community channel messages. When a channel group key
// exists, the message `content` carried by PUBLISH is wrapped — the relay only
// ever stores ciphertext. Recipients without the key see a lock placeholder
// until it arrives. No key yet (rollout) → plaintext fallback.
const CHAN_ENC_PREFIX = '__CHENC__';
function packChanEnc(enc: { ciphertext: string; nonce: string; epoch: number }): string {
  return CHAN_ENC_PREFIX + JSON.stringify({ c: enc.ciphertext, n: enc.nonce, e: enc.epoch });
}
function isChanEnc(s: string | undefined): boolean {
  return typeof s === 'string' && s.startsWith(CHAN_ENC_PREFIX);
}
/** Re-derive a ChatMessage's display fields from decrypted plaintext (which may
 *  itself be a file/blob marker). */
function applyDecrypted(m: ChatMessage, plain: string): ChatMessage {
  const blob = decodeBlobContent(plain);
  if (blob) return { ...m, content: '', fileName: blob.fileName, mimeType: blob.mimeType, fileSize: blob.fileSize, blobRoot: blob.blobRoot, envelopeId: blob.envelopeId, blobStatus: 'pending' };
  const file = decodeFileContent(plain);
  if (file) return { ...m, content: file.text || '', fileId: file.fileId, fileName: file.fileName, mimeType: file.mimeType, fileSize: file.fileSize };
  return { ...m, content: plain };
}
/** Async-decrypt a ciphertext channel message and patch it into state. */
function decryptChannelInto(channel: string, messageId: string, raw: string): void {
  if (!isChanEnc(raw)) return;
  try {
    const { c, n, e } = JSON.parse(raw.slice(CHAN_ENC_PREFIX.length));
    void useGroupCryptoStore.getState().decrypt(channel, c, n, e).then((plain) => {
      if (plain == null) return;
      useChatStore.setState((s) => ({
        messages: { ...s.messages, [channel]: (s.messages[channel] || []).map((m) => m.messageId === messageId ? applyDecrypted(m, plain) : m) },
      }));
    });
  } catch { /* leave placeholder */ }
}

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

/** R25 — Phase 4. Encode a blob-attachment reference for DB persistence. */
function encodeBlobContent(fileName: string, mimeType: string, fileSize: number, blobRoot: string, envelopeId: string): string {
  return BLOB_PREFIX + JSON.stringify({ fileName, mimeType, fileSize, blobRoot, envelopeId });
}

function decodeBlobContent(content: string): { fileName: string; mimeType: string; fileSize: number; blobRoot: string; envelopeId: string } | null {
  if (!content.startsWith(BLOB_PREFIX)) return null;
  try {
    return JSON.parse(content.slice(BLOB_PREFIX.length));
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
  // R25 — Phase 4: blob-backed attachment (envelope + content-addressed pieces).
  /** hex(blobRef.root) — present for attachments delivered over the blob path. */
  blobRoot?: string;
  /** hex(envelopeId) of the carrying envelope (so we can re-fetch on demand). */
  envelopeId?: string;
  /** Object URL once the blob is fetched + decrypted, ready to render/download. */
  attachmentUrl?: string;
  /** Lifecycle of a blob attachment in the UI. */
  blobStatus?: 'pending' | 'loading' | 'ready' | 'failed';
}

export interface PresenceUser { publicKey: string; username: string; status: string; }

interface ChatState {
  messages: Record<string, ChatMessage[]>;
  presence: Record<string, PresenceUser[]>;
  activeChannel: string | null;
  subscribe: (channels: string[]) => void;
  unsubscribe: (channels: string[]) => void;
  sendMessage: (channel: string, content: string) => void;
  /** R25 — Phase 4. Send a file/image as an envelope + content-addressed blob. */
  sendFile: (channel: string, file: File) => Promise<void>;
  /** R25 — Phase 4. Fetch + decrypt a blob attachment and attach its object URL. */
  fetchAttachment: (channel: string, messageId: string) => Promise<void>;
  deleteMessage: (channel: string, messageId: string) => void;
  setActiveChannel: (channelId: string | null) => void;
  clear: () => void;
  init: () => () => void;
}

/** R25 — Phase 4. Reverse index: hex(channelId) → channel string. Populated
 *  on subscribe so incoming blob envelopes can be routed to the right
 *  channel (channelId is a one-way hash of the channel string). */
const channelIdIndex = new Map<string, string>();

/** Prepend a 2-byte length-prefixed filename to the file bytes before
 *  encryption, so the receiver recovers the original name from the
 *  (otherwise opaque) blob. Layout: [u16be nameLen][name utf8][bytes]. */
function packBlobPayload(fileName: string, bytes: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(fileName);
  if (nameBytes.length > 0xffff) throw new Error('filename too long');
  const out = new Uint8Array(2 + nameBytes.length + bytes.length);
  out[0] = (nameBytes.length >> 8) & 0xff;
  out[1] = nameBytes.length & 0xff;
  out.set(nameBytes, 2);
  out.set(bytes, 2 + nameBytes.length);
  return out;
}

function unpackBlobPayload(buf: Uint8Array): { fileName: string; bytes: Uint8Array } {
  if (buf.length < 2) return { fileName: 'attachment', bytes: buf };
  const nameLen = (buf[0]! << 8) | buf[1]!;
  if (2 + nameLen > buf.length) return { fileName: 'attachment', bytes: buf };
  const fileName = new TextDecoder().decode(buf.slice(2, 2 + nameLen));
  return { fileName, bytes: buf.slice(2 + nameLen) };
}

/** Map an IANA mime to the envelope kind we tag the blob with. */
function kindForMime(mime: string): EnvelopeKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'voice';
  return 'file';
}

const browserDB = new BrowserDB();

/** Convert a DB message to a ChatMessage, detecting file messages. */
function dbMsgToChatMsg(msg: DBMessage, myKey: string): ChatMessage {
  // Encrypted content → show a lock placeholder; caller triggers async decrypt.
  if (isChanEnc(msg.content)) {
    return {
      messageId: msg.messageId, channel: msg.channel, content: '\u{1F512}…',
      senderPublicKey: msg.senderPublicKey, senderUsername: msg.senderUsername,
      timestamp: msg.timestamp, isOwn: msg.senderPublicKey === myKey,
    };
  }
  const blobData = decodeBlobContent(msg.content);
  if (blobData) {
    return {
      messageId: msg.messageId, channel: msg.channel, content: '',
      senderPublicKey: msg.senderPublicKey, senderUsername: msg.senderUsername,
      timestamp: msg.timestamp, isOwn: msg.senderPublicKey === myKey,
      fileName: blobData.fileName, mimeType: blobData.mimeType, fileSize: blobData.fileSize,
      blobRoot: blobData.blobRoot, envelopeId: blobData.envelopeId,
      blobStatus: 'pending',
    };
  }
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
      // R25 — Phase 4. Index channelId hash → channel string so incoming
      // blob envelopes can be routed back to this channel.
      channelIdIndex.set(toHex(channelIdBytes(channelId)), channelId);
      // E2E: fetch this channel's group key so encrypted messages decrypt.
      useGroupCryptoStore.getState().requestKeys(channelId);
      browserDB.getMessages(channelId).then((dbMsgs) => {
        if (dbMsgs.length > 0) {
          set((state) => ({ messages: { ...state.messages, [channelId]: dbMsgs.map((m) => dbMsgToChatMsg(m, myKey)) } }));
          for (const m of dbMsgs) { if (isChanEnc(m.content)) decryptChannelInto(channelId, m.messageId, m.content); }
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
    const privateKey = getPrivateKey();

    // Optimistic local display in plaintext.
    set((state) => ({
      messages: { ...state.messages, [channel]: [...(state.messages[channel] || []), { messageId, channel, content, senderPublicKey: network.publicKey, senderUsername: network.username, timestamp, isOwn: true }] },
    }));

    // E2E: wrap the content with the channel group key if one exists. The wire
    // + on-disk copy hold ciphertext; the relay never sees plaintext. Without a
    // key yet (rollout) fall back to plaintext.
    void useGroupCryptoStore.getState().encrypt(channel, content).then((enc) => {
      const wire = enc ? packChanEnc(enc) : content;
      const payload = { channel, content: wire, messageId, timestamp };

      // Persist the (possibly encrypted) wire form so reloads stay consistent.
      browserDB.addMessage({ messageId, channel, content: wire, senderPublicKey: network.publicKey, senderUsername: network.username, timestamp, signature: '' });
      browserDB.setLastSyncTimestamp(channel, timestamp);

      const publish = (signature: string) => network.transport!.send({ type: 'PUBLISH', payload, timestamp, signature, senderPublicKey: network.publicKey });
      if (privateKey) {
        signPayload(JSON.stringify(payload), privateKey).then(publish).catch(() => publish(''));
      } else {
        publish('');
      }
    });

    // R25 — Phase 1: dual-write through the envelope path (group-encrypted body).
    if (TWO_LAYER_ENABLED && privateKey) {
      void sendAsEnvelope(channel, content, network.publicKey, privateKey).catch((err) => {
        console.warn('[chat] envelope dual-write failed:', err);
      });
    }
  },

  // R25 — Phase 4. File/image attachments now ride the content-addressed
  // blob path: the file is encrypted under a per-blob key (wrapped to the
  // channel), split into 256-KB pieces, uploaded, and referenced by an
  // ENVELOPE. Receivers pull pieces back via fetchAttachment. This replaces
  // the legacy 1-MB UPLOAD_FILE flow.
  sendFile: async (channel, file) => {
    const network = useNetworkStore.getState();
    if (!network.transport?.isConnected) return;
    const privateKey = getPrivateKey();
    if (!privateKey) { console.warn('[chat] sendFile: no private key'); return; }

    const groupCrypto = useGroupCryptoStore.getState();
    const epoch = groupCrypto.channels.get(channel)?.currentEpoch ?? 0;
    const mime = file.type || 'application/octet-stream';
    const kind = kindForMime(mime);

    const raw = new Uint8Array(await file.arrayBuffer());
    const packed = packBlobPayload(file.name, raw);

    const built = await buildEnvelope({
      communityId: communityIdBytesFromChannel(channel),
      channelId: channelIdBytes(channel),
      senderPubkey: fromHex(network.publicKey),
      senderPrivkey: privateKey,
      kind,
      payload: packed,
      mime,
      epoch,
      // Inline path is never taken for blobs; stub to satisfy the type.
      encryptBody: async () => { throw new Error('unreachable: blob body'); },
      wrapBlobKey: async (blobKey) => {
        const { wrap, nonce } = await groupCrypto.wrapBlobKey(channel, blobKey);
        return { wrap, nonce };
      },
    });

    const messageId = uuid();
    const timestamp = Date.now();
    const blobRootHex = built.blob ? toHex(built.blob.root) : undefined;
    const envelopeIdHex = toHex(built.envelopeId);
    // Optimistic local render — sender sees the file instantly from a local
    // object URL, no round-trip needed.
    const localUrl = URL.createObjectURL(file);
    const localMsg: ChatMessage = {
      messageId, channel, content: '',
      senderPublicKey: network.publicKey, senderUsername: network.username,
      timestamp, isOwn: true,
      fileName: file.name, mimeType: mime, fileSize: file.size,
      blobRoot: blobRootHex, envelopeId: envelopeIdHex,
      attachmentUrl: localUrl, blobStatus: 'ready',
    };
    set((state) => ({
      messages: { ...state.messages, [channel]: [...(state.messages[channel] || []), localMsg] },
    }));
    // Persist a reference so the message survives reload (re-fetched lazily).
    browserDB.addMessage({
      messageId, channel,
      content: encodeBlobContent(file.name, mime, file.size, blobRootHex ?? '', envelopeIdHex),
      senderPublicKey: network.publicKey, senderUsername: network.username,
      timestamp, signature: '',
    });
    browserDB.setLastSyncTimestamp(channel, timestamp);

    await sendBuiltEnvelope({
      send: (m) => network.transport!.send(m),
      isConnected: network.transport.isConnected,
    }, built);
  },

  fetchAttachment: async (channel, messageId) => {
    const st = get();
    const list = st.messages[channel] || [];
    const msg = list.find((m) => m.messageId === messageId);
    if (!msg || !msg.envelopeId || !msg.blobRoot) return;
    if (msg.blobStatus === 'loading' || msg.blobStatus === 'ready') return;

    const patch = (m: ChatMessage, p: Partial<ChatMessage>): ChatMessage => ({ ...m, ...p });
    const update = (p: Partial<ChatMessage>) => set((state) => ({
      messages: {
        ...state.messages,
        [channel]: (state.messages[channel] || []).map((m) => m.messageId === messageId ? patch(m, p) : m),
      },
    }));
    update({ blobStatus: 'loading' });

    try {
      const env = await browserDB.getEnvelope(msg.envelopeId);
      if (!env) throw new Error('envelope not cached');
      const bin = Uint8Array.from(atob(env.cborB64), (c) => c.charCodeAt(0));
      const decoded = fromCborMap(decodeCanonical(bin) as Record<string, unknown>);
      if (decoded.body.inline) throw new Error('envelope has no blob');
      const blobRef: BlobRef = decoded.body.blobRef;

      const network = useNetworkStore.getState();
      const groupCrypto = useGroupCryptoStore.getState();
      const cache = usePieceCacheStore.getState();

      const cipherPlain = await fetchBlob(
        {
          send: (m) => network.transport!.send(m),
          isConnected: !!network.transport?.isConnected,
          onMessage: network.onMessage,
        },
        blobRef,
        (wrap, nonce, ep) => groupCrypto.unwrapBlobKey(channel, wrap, nonce, ep),
        { cache: { getByIndex: cache.getByIndex, put: cache.put } },
      );

      const { fileName, bytes } = unpackBlobPayload(cipherPlain);
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const blob = new Blob([ab], { type: blobRef.mime });
      const url = URL.createObjectURL(blob);
      update({ attachmentUrl: url, fileName, fileSize: bytes.length, blobStatus: 'ready' });
    } catch (err) {
      console.warn('[chat] fetchAttachment failed:', err);
      update({ blobStatus: 'failed' });
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
          const enc = isChanEnc(p.content);
          const chatMsg: ChatMessage = { messageId: p.messageId, channel: p.channel, content: enc ? '\u{1F512}…' : p.content, senderPublicKey: p.senderPublicKey, senderUsername: p.senderUsername, timestamp: p.timestamp, isOwn: p.senderPublicKey === myKey };
          // Store the wire form (ciphertext if encrypted) so reloads decrypt too.
          browserDB.addMessage({ messageId: p.messageId, channel: p.channel, content: p.content, senderPublicKey: p.senderPublicKey, senderUsername: p.senderUsername, timestamp: p.timestamp, signature: (msg as any).signature || '' });
          browserDB.setLastSyncTimestamp(p.channel, p.timestamp);
          set((state) => {
            const existing = state.messages[p.channel] || [];
            if (existing.some((m) => m.messageId === chatMsg.messageId)) return state;
            return { messages: { ...state.messages, [p.channel]: [...existing, chatMsg].sort((a, b) => a.timestamp - b.timestamp) } };
          });
          if (enc) decryptChannelInto(p.channel, p.messageId, p.content);
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
          for (const m of synced) { if (isChanEnc(m.content)) decryptChannelInto(p.channel, m.messageId, m.content); }
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

            // R25 — Phase 4. A blob envelope of kind file/image/voice is an
            // attachment from another member. Render a placeholder in the
            // matching channel and auto-fetch it. Skip our own (we already
            // rendered optimistically in sendFile).
            if (!env.body.inline && (env.kind === 'file' || env.kind === 'image' || env.kind === 'voice')) {
              const senderHex = toHex(env.senderPubkey);
              if (senderHex !== myKey) {
                const channel = channelIdIndex.get(toHex(env.channelId));
                if (channel) {
                  const blobRoot = toHex((env.body as any).blobRef.root);
                  const mime = (env.body as any).blobRef.mime as string;
                  const size = (env.body as any).blobRef.size as number;
                  const envelopeIdHex = toHex(id);
                  const placeholder: ChatMessage = {
                    messageId: envelopeIdHex, channel, content: '',
                    senderPublicKey: senderHex, senderUsername: senderHex.slice(0, 8),
                    timestamp: env.ts, isOwn: false,
                    fileName: 'attachment', mimeType: mime, fileSize: size,
                    blobRoot, envelopeId: envelopeIdHex, blobStatus: 'pending',
                  };
                  browserDB.addMessage({
                    messageId: envelopeIdHex, channel,
                    content: encodeBlobContent('attachment', mime, size, blobRoot, envelopeIdHex),
                    senderPublicKey: senderHex, senderUsername: senderHex.slice(0, 8),
                    timestamp: env.ts, signature: '',
                  });
                  set((state) => {
                    const existing = state.messages[channel] || [];
                    if (existing.some((m) => m.messageId === envelopeIdHex)) return state;
                    return { messages: { ...state.messages, [channel]: [...existing, placeholder].sort((a, b) => a.timestamp - b.timestamp) } };
                  });
                  void useChatStore.getState().fetchAttachment(channel, envelopeIdHex);
                }
              }
            }
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
