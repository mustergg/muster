/**
 * DM Store — R14 E2E Encryption
 *
 * Changes: DM messages are now encrypted with AES-256-GCM before sending.
 * Uses ECDH (X25519) key exchange — the relay only sees ciphertext.
 * Backward compatible: unencrypted messages from before R14 display normally.
 */

import { create } from 'zustand';
import { useNetworkStore } from './networkStore';
import { BrowserDB } from '@muster/db';
import { sign as ed25519Sign, toHex, fromHex } from '@muster/crypto';
import { encryptDM, decryptDM, isE2EEncrypted, currentInboxHashes } from '@muster/crypto/e2e';
import { buildSealedDmFrame, openSealedDmFrame, type SealedDmAttachment } from '../lib/sealedDm';
import { buildAndUploadBlob, fetchAndDecryptBlob } from '../lib/blobUpload';
import type { TransportMessage } from '@muster/transport';

const encoder = new TextEncoder();

async function signPayload(payload: string, privateKey: Uint8Array): Promise<string> {
  const sigBytes = await ed25519Sign(encoder.encode(payload), privateKey);
  return toHex(sigBytes);
}

function getKeypair(): { privateKey: Uint8Array; publicKey: Uint8Array } | null {
  try {
    const authStore = (window as any).__authStore;
    if (authStore) {
      const kp = authStore.getState()._keypair;
      if (kp) return { privateKey: kp.privateKey, publicKey: kp.publicKey };
    }
    return null;
  } catch { return null; }
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Try to decrypt DM content. If the sender's public key is known,
 * decrypt using ECDH. If decryption fails, return the raw content.
 */
function tryDecryptDM(content: string, senderPublicKeyHex: string, recipientPublicKeyHex: string, myKey: string): string {
  if (!isE2EEncrypted(content)) return content;

  const kp = getKeypair();
  if (!kp) return '[Encrypted message — keypair unavailable]';

  try {
    // Determine which public key is "theirs"
    const theirHex = senderPublicKeyHex === myKey ? recipientPublicKeyHex : senderPublicKeyHex;
    const theirPublic = fromHex(theirHex);
    return decryptDM(content, kp.privateKey, theirPublic);
  } catch {
    return '[Encrypted message — decryption failed]';
  }
}

export interface DMMessage {
  messageId: string; content: string; senderPublicKey: string; senderUsername: string;
  recipientPublicKey: string; timestamp: number; isOwn: boolean;
  encrypted?: boolean;
  edited?: boolean;
  // R25: blob attachment (file / voice note) carried via sealed DM.
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  attachmentUrl?: string;
  blobStatus?: 'pending' | 'loading' | 'ready' | 'failed';
  _attachment?: SealedDmAttachment;
}

export interface DMConversation {
  publicKey: string; username: string; lastMessage: string; lastTimestamp: number; unreadCount: number;
}

interface DMState {
  messages: Record<string, DMMessage[]>;
  conversations: DMConversation[];
  activeConversation: string | null;
  sendDM: (recipientPublicKey: string, content: string) => void;
  /** R25: send a file/voice attachment over a sealed DM. */
  sendDMFile: (recipientPublicKey: string, file: File) => Promise<string>;
  /** R25: fetch + decrypt a DM attachment, attach its object URL. */
  fetchDMAttachment: (partnerPublicKey: string, messageId: string) => Promise<void>;
  openConversation: (publicKey: string, username?: string) => void;
  loadConversations: () => void;
  setActiveConversation: (publicKey: string | null) => void;
  clearConversation: (publicKey: string) => void;
  /** Delete one of your own DMs (both sides). */
  deleteDM: (partnerPublicKey: string, messageId: string) => void;
  /** Edit one of your own DMs within the window (re-encrypts). */
  editDM: (partnerPublicKey: string, messageId: string, content: string) => void;
  /** R25 — Phase 8. (Re)subscribe to our rotating inbox hashes. */
  subscribeInbox: () => void;
  init: () => () => void;
}

const dmDB = new BrowserDB();

/**
 * Per-partner "cleared" watermark. When the user deletes a DM conversation we
 * record the delete timestamp locally (the relay still keeps the history for
 * the *other* side). Any history older than the watermark is never re-shown to
 * the deleter: requests use it as `since`, and conversations whose newest
 * message predates it stay hidden. A later reply (ts > watermark) reappears,
 * showing only messages from the delete point onward.
 *
 * Watermarks are per-account so a shared browser doesn't leak deletes between
 * users — keyed by the local public key.
 */
const LS_DM_CLEARED = 'muster-dm-cleared';
function clearedKey(): string {
  const myKey = useNetworkStore.getState().publicKey || 'anon';
  return `${LS_DM_CLEARED}:${myKey}`;
}
function loadCleared(): Record<string, number> {
  try { const r = localStorage.getItem(clearedKey()); return r ? JSON.parse(r) as Record<string, number> : {}; } catch { return {}; }
}
function saveCleared(map: Record<string, number>): void {
  try { localStorage.setItem(clearedKey(), JSON.stringify(map)); } catch { /* ignore */ }
}
function clearedAtFor(publicKey: string): number {
  return loadCleared()[publicKey] ?? 0;
}

/** R25 — Phase 8. Send DM_SUBSCRIBE for our current/prev/next inbox hashes.
 *  Called on init + every window so a DM near a rotation boundary lands. */
function sendInboxSubscribe(): void {
  const network = useNetworkStore.getState();
  if (!network.transport?.isConnected || !network.publicKey) return;
  try {
    const { prev, current, next } = currentInboxHashes(fromHex(network.publicKey));
    const inboxHashes = [toHex(prev), toHex(current), toHex(next)];
    network.transport.send({ type: 'DM_SUBSCRIBE', payload: { inboxHashes }, timestamp: Date.now() });
  } catch (err) {
    console.warn('[dm] inbox subscribe failed:', err);
  }
}

export const useDMStore = create<DMState>((set, get) => ({
  messages: {},
  conversations: [],
  activeConversation: null,

  sendDM: (recipientPublicKey, content) => {
    const network = useNetworkStore.getState();
    if (!network.transport?.isConnected) return;

    const messageId = uuid();
    const timestamp = Date.now();

    // Encrypt the message before sending
    const kp = getKeypair();
    let encryptedContent = content;
    let encrypted = false;

    if (kp) {
      try {
        const recipientPublicBytes = fromHex(recipientPublicKey);
        encryptedContent = encryptDM(content, kp.privateKey, recipientPublicBytes);
        encrypted = true;
      } catch (err) {
        console.warn('[dm] E2E encryption failed, sending unencrypted:', err);
        encryptedContent = content;
      }
    }

    const payload = { recipientPublicKey, content: encryptedContent, messageId, timestamp };
    const payloadStr = JSON.stringify(payload);

    // Optimistic update — show plaintext locally
    const msg: DMMessage = {
      messageId, content, senderPublicKey: network.publicKey,
      senderUsername: network.username, recipientPublicKey,
      timestamp, isOwn: true, encrypted,
    };
    set((state) => ({
      messages: { ...state.messages, [recipientPublicKey]: [...(state.messages[recipientPublicKey] || []), msg] },
    }));

    // Store encrypted content in local DB
    dmDB.addMessage({
      messageId, channel: `dm:${[network.publicKey, recipientPublicKey].sort().join(':')}`,
      content: encryptedContent, senderPublicKey: network.publicKey,
      senderUsername: network.username, timestamp, signature: '',
    });

    // Sign and send
    if (kp) {
      signPayload(payloadStr, kp.privateKey).then((signature) => {
        network.transport!.send({ type: 'SEND_DM', payload, signature, senderPublicKey: network.publicKey, timestamp });
      }).catch(() => {
        network.transport!.send({ type: 'SEND_DM', payload, signature: '', senderPublicKey: network.publicKey, timestamp });
      });
    } else {
      network.transport!.send({ type: 'SEND_DM', payload, signature: '', senderPublicKey: network.publicKey, timestamp });
    }

    // R25 — Phase 8. Also publish a sealed-sender frame addressed to the
    // recipient's rotating inbox hash. The relay routes it without ever
    // seeing the recipient pubkey; the legacy SEND_DM above stays as the
    // durable history path. Same messageId → recipient dedups the two.
    try {
      const built = buildSealedDmFrame({
        recipientEdPubHex: recipientPublicKey,
        senderEdPubHex: network.publicKey,
        senderUsername: network.username,
        messageId,
        content,
        nowMs: timestamp,
      });
      if (built) {
        network.transport.send({ type: 'DM_FRAME', payload: { cbor: built.cborB64 }, timestamp });
      }
    } catch (err) {
      console.warn('[dm] sealed frame send failed:', err);
    }
  },

  sendDMFile: async (recipientPublicKey, file) => {
    const network = useNetworkStore.getState();
    if (!network.transport?.isConnected) return '';
    const kp = getKeypair();
    if (!kp) { console.warn('[dm] sendDMFile: no keypair'); return ''; }

    const messageId = uuid();
    const timestamp = Date.now();
    const mime = file.type || 'application/octet-stream';
    const raw = new Uint8Array(await file.arrayBuffer());

    // Upload encrypted blob (content-addressed). Key travels inside the
    // sealed DM, which is itself E2E to the recipient.
    let uploaded;
    try {
      uploaded = await buildAndUploadBlob(
        { send: (m) => network.transport!.send(m), isConnected: network.transport.isConnected },
        raw, mime,
      );
    } catch (err) {
      console.warn('[dm] blob upload failed:', err);
      return '';
    }
    const attachment: SealedDmAttachment = {
      root: uploaded.rootHex, size: uploaded.size, mime, name: file.name,
      pieceCount: uploaded.pieceCount, key: uploaded.keyHex,
    };

    // Optimistic local render via a local object URL.
    const localUrl = URL.createObjectURL(file);
    const msg: DMMessage = {
      messageId, content: '', senderPublicKey: network.publicKey,
      senderUsername: network.username, recipientPublicKey, timestamp, isOwn: true, encrypted: true,
      fileName: file.name, mimeType: mime, fileSize: file.size,
      attachmentUrl: localUrl, blobStatus: 'ready', _attachment: attachment,
    };
    set((state) => ({
      messages: { ...state.messages, [recipientPublicKey]: [...(state.messages[recipientPublicKey] || []), msg] },
    }));

    try {
      const built = buildSealedDmFrame({
        recipientEdPubHex: recipientPublicKey,
        senderEdPubHex: network.publicKey,
        senderUsername: network.username,
        messageId, content: '', attachment, nowMs: timestamp,
      });
      if (built) network.transport.send({ type: 'DM_FRAME', payload: { cbor: built.cborB64 }, timestamp });
    } catch (err) {
      console.warn('[dm] sealed file frame failed:', err);
    }
    return messageId;
  },

  fetchDMAttachment: async (partnerPublicKey, messageId) => {
    const st = get();
    const list = st.messages[partnerPublicKey] || [];
    const msg = list.find((m) => m.messageId === messageId);
    if (!msg || !msg._attachment) return;
    if (msg.blobStatus === 'loading' || msg.blobStatus === 'ready') return;
    const update = (p: Partial<DMMessage>) => set((state) => ({
      messages: {
        ...state.messages,
        [partnerPublicKey]: (state.messages[partnerPublicKey] || []).map((m) => m.messageId === messageId ? { ...m, ...p } : m),
      },
    }));
    update({ blobStatus: 'loading' });
    try {
      const network = useNetworkStore.getState();
      const bytes = await fetchAndDecryptBlob(
        { send: (m) => network.transport!.send(m), isConnected: !!network.transport?.isConnected, onMessage: network.onMessage },
        { rootHex: msg._attachment.root, size: msg._attachment.size, mime: msg._attachment.mime, pieceCount: msg._attachment.pieceCount, keyHex: msg._attachment.key },
      );
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const url = URL.createObjectURL(new Blob([ab], { type: msg._attachment.mime }));
      update({ attachmentUrl: url, blobStatus: 'ready' });
    } catch (err) {
      console.warn('[dm] fetchDMAttachment failed:', err);
      update({ blobStatus: 'failed' });
    }
  },

  openConversation: (publicKey, username) => {
    set((state) => {
      const exists = state.conversations.some((c) => c.publicKey === publicKey);
      const conversations = exists
        ? state.conversations.map((c) => c.publicKey === publicKey ? { ...c, unreadCount: 0, username: username || c.username } : c)
        // New/empty chat: add a stub so it shows in the DM list right away.
        : [{ publicKey, username: username || (publicKey.slice(0, 8) + '…'), lastMessage: '', lastTimestamp: Date.now(), unreadCount: 0 }, ...state.conversations];
      return { activeConversation: publicKey, conversations };
    });

    // Load cached history from the local DB first so conversations persist
    // across reloads — including the Node Bot, which the relay does not store.
    const myKey = useNetworkStore.getState().publicKey;
    const channelKey = `dm:${[myKey, publicKey].sort().join(':')}`;
    const clearedAt = clearedAtFor(publicKey);
    dmDB.getMessages(channelKey).then((dbMsgs) => {
      if (!dbMsgs || dbMsgs.length === 0) return;
      const cached: DMMessage[] = dbMsgs.filter((m) => m.timestamp > clearedAt).map((m) => ({
        messageId: m.messageId,
        content: tryDecryptDM(m.content, m.senderPublicKey, publicKey, myKey),
        senderPublicKey: m.senderPublicKey, senderUsername: m.senderUsername,
        recipientPublicKey: m.senderPublicKey === myKey ? publicKey : myKey,
        timestamp: m.timestamp, isOwn: m.senderPublicKey === myKey,
        encrypted: isE2EEncrypted(m.content),
      }));
      set((state) => {
        const existing = state.messages[publicKey] || [];
        const ids = new Set(existing.map((x) => x.messageId));
        const merged = [...existing, ...cached.filter((x) => !ids.has(x.messageId))].sort((a, b) => a.timestamp - b.timestamp);
        return { messages: { ...state.messages, [publicKey]: merged } };
      });
    }).catch(() => { /* ignore cache errors */ });

    const network = useNetworkStore.getState();
    if (!network.transport?.isConnected) return;
    network.transport.send({ type: 'DM_HISTORY_REQUEST', payload: { otherPublicKey: publicKey, since: clearedAt }, timestamp: Date.now() });
  },

  loadConversations: () => {
    const network = useNetworkStore.getState();
    if (!network.transport?.isConnected) return;
    network.transport.send({ type: 'DM_CONVERSATIONS_REQUEST', payload: {}, timestamp: Date.now() });
  },

  setActiveConversation: (publicKey) => {
    set((state) => ({
      activeConversation: publicKey,
      conversations: publicKey
        ? state.conversations.map((c) => c.publicKey === publicKey ? { ...c, unreadCount: 0 } : c)
        : state.conversations,
    }));
  },

  clearConversation: (publicKey) => {
    // Record the delete watermark first so any in-flight responses are gated.
    const cleared = loadCleared();
    cleared[publicKey] = Date.now();
    saveCleared(cleared);

    set((state) => ({
      messages: (() => { const m = { ...state.messages }; delete m[publicKey]; return m; })(),
      conversations: state.conversations.filter((c) => c.publicKey !== publicKey),
      activeConversation: state.activeConversation === publicKey ? null : state.activeConversation,
    }));
    const myKey = useNetworkStore.getState().publicKey;
    const channelKey = `dm:${[myKey, publicKey].sort().join(':')}`;
    dmDB.clearChannel(channelKey);
  },

  deleteDM: (partnerPublicKey, messageId) => {
    const network = useNetworkStore.getState();
    if (!network.transport?.isConnected) return;
    set((state) => ({
      messages: { ...state.messages, [partnerPublicKey]: (state.messages[partnerPublicKey] || []).filter((m) => m.messageId !== messageId) },
    }));
    void dmDB.deleteMessage(messageId);
    network.transport.send({ type: 'DELETE_DM', payload: { messageId }, timestamp: Date.now() });
  },

  editDM: (partnerPublicKey, messageId, content) => {
    const network = useNetworkStore.getState();
    if (!network.transport?.isConnected) return;
    const kp = getKeypair();
    let wire = content;
    if (kp) { try { wire = encryptDM(content, kp.privateKey, fromHex(partnerPublicKey)); } catch { /* plaintext fallback */ } }
    set((state) => ({
      messages: { ...state.messages, [partnerPublicKey]: (state.messages[partnerPublicKey] || []).map((m) => m.messageId === messageId ? { ...m, content, edited: true } : m) },
    }));
    void dmDB.updateContent(messageId, wire);
    network.transport.send({ type: 'EDIT_DM', payload: { messageId, content: wire }, timestamp: Date.now() });
  },

  subscribeInbox: () => sendInboxSubscribe(),

  init: () => {
    const network = useNetworkStore.getState();
    const myKey = network.publicKey;

    // R25 — Phase 8. Subscribe to our rotating inbox hashes now and refresh
    // every hour (windows are 6h; hourly keeps prev/current/next fresh and
    // re-registers after any relay restart).
    sendInboxSubscribe();
    const inboxTimer = setInterval(sendInboxSubscribe, 60 * 60 * 1000);

    // Load conversations on connect so DM unread badges appear without having
    // to open the DM view first.
    get().loadConversations();

    const unsubscribe = network.onMessage((msg: TransportMessage) => {
      switch (msg.type) {
        case 'DM_MESSAGE': {
          const p = msg.payload as any;
          const otherKey = p.senderPublicKey === myKey ? p.recipientPublicKey : p.senderPublicKey;
          const isOwn = p.senderPublicKey === myKey;

          // Drop replays of deleted history (older than the delete watermark).
          if (p.timestamp <= clearedAtFor(otherKey)) break;

          // Decrypt the message content
          const decryptedContent = tryDecryptDM(p.content, p.senderPublicKey, p.recipientPublicKey, myKey);
          const encrypted = isE2EEncrypted(p.content);

          const dmMsg: DMMessage = {
            messageId: p.messageId, content: decryptedContent,
            senderPublicKey: p.senderPublicKey, senderUsername: p.senderUsername,
            recipientPublicKey: p.recipientPublicKey, timestamp: p.timestamp,
            isOwn, encrypted,
          };

          // Duplicate (e.g. re-sent bot welcome, reconnect replay) → ignore
          // entirely so it doesn't bump unread badges.
          if ((get().messages[otherKey] || []).some((m) => m.messageId === dmMsg.messageId)) break;

          set((state) => {
            const existing = state.messages[otherKey] || [];
            return { messages: { ...state.messages, [otherKey]: [...existing, dmMsg].sort((a, b) => a.timestamp - b.timestamp) } };
          });

          // Store encrypted content in local DB (not decrypted)
          dmDB.addMessage({
            messageId: p.messageId,
            channel: `dm:${[myKey, otherKey].sort().join(':')}`,
            content: p.content, // Store encrypted form
            senderPublicKey: p.senderPublicKey,
            senderUsername: p.senderUsername,
            timestamp: p.timestamp,
            signature: (msg as any).signature || '',
          });

          // Update conversation list + unread count
          set((state) => {
            const convs = [...state.conversations];
            const idx = convs.findIndex((c) => c.publicKey === otherKey);
            const otherName = isOwn ? (p.recipientUsername || otherKey.slice(0, 8) + '...') : p.senderUsername;
            const isActive = state.activeConversation === otherKey;

            // Show decrypted preview in conversation list
            const previewContent = decryptedContent.length > 50 ? decryptedContent.slice(0, 50) + '...' : decryptedContent;

            if (idx >= 0) {
              const prev = convs[idx]!;
              convs[idx] = {
                ...prev,
                lastMessage: previewContent,
                lastTimestamp: p.timestamp,
                username: otherName || prev.username,
                unreadCount: (!isOwn && !isActive) ? (prev.unreadCount || 0) + 1 : prev.unreadCount,
              };
            } else {
              convs.unshift({
                publicKey: otherKey,
                username: otherName,
                lastMessage: previewContent,
                lastTimestamp: p.timestamp,
                unreadCount: (!isOwn && !isActive) ? 1 : 0,
              });
            }
            convs.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
            return { conversations: convs };
          });
          break;
        }

        case 'DM_DELETED': {
          const p = msg.payload as any;
          const otherKey = p.senderPublicKey === myKey ? p.recipientPublicKey : p.senderPublicKey;
          set((state) => ({
            messages: { ...state.messages, [otherKey]: (state.messages[otherKey] || []).filter((m) => m.messageId !== p.messageId) },
          }));
          void dmDB.deleteMessage(p.messageId);
          break;
        }
        case 'DM_EDITED': {
          const p = msg.payload as any;
          const otherKey = p.senderPublicKey === myKey ? p.recipientPublicKey : p.senderPublicKey;
          const decrypted = tryDecryptDM(p.content, p.senderPublicKey, p.recipientPublicKey, myKey);
          set((state) => ({
            messages: { ...state.messages, [otherKey]: (state.messages[otherKey] || []).map((m) => m.messageId === p.messageId ? { ...m, content: decrypted, edited: true } : m) },
          }));
          void dmDB.updateContent(p.messageId, p.content);
          break;
        }
        case 'DM_HISTORY_RESPONSE': {
          const p = msg.payload as any;
          const histClearedAt = clearedAtFor(p.otherPublicKey);
          const msgs: DMMessage[] = (p.messages || []).filter((m: any) => m.timestamp > histClearedAt).map((m: any) => {
            const decrypted = tryDecryptDM(m.content, m.senderPublicKey, m.recipientPublicKey, myKey);
            return {
              messageId: m.messageId, content: decrypted,
              senderPublicKey: m.senderPublicKey, senderUsername: m.senderUsername,
              recipientPublicKey: m.recipientPublicKey, timestamp: m.timestamp,
              isOwn: m.senderPublicKey === myKey, encrypted: isE2EEncrypted(m.content),
            };
          });
          // Merge with any locally-cached / in-memory messages (dedup by id)
          // rather than replacing — preserves bot DMs + optimistic sends.
          set((state) => {
            const existing = state.messages[p.otherPublicKey] || [];
            const ids = new Set(existing.map((x) => x.messageId));
            const merged = [...existing, ...msgs.filter((x) => !ids.has(x.messageId))].sort((a, b) => a.timestamp - b.timestamp);
            return { messages: { ...state.messages, [p.otherPublicKey]: merged } };
          });
          break;
        }

        case 'DM_CONVERSATIONS_RESPONSE': {
          const p = msg.payload as any;
          const incoming: DMConversation[] = p.conversations || [];
          // Merge with existing — preserve client-side unreadCount (relay
          // doesn't track per-client read state) and keep any conversations
          // the relay doesn't know about (e.g. the Node Bot).
          set((state) => {
            const byKey = new Map(state.conversations.map((c) => [c.publicKey, c]));
            for (const inc of incoming) {
              // Skip conversations the user deleted that have no newer message
              // than the delete watermark — they stay hidden until a reply.
              if ((inc.lastTimestamp ?? 0) <= clearedAtFor(inc.publicKey)) continue;
              const prev = byKey.get(inc.publicKey);
              // Relay stores ciphertext, so its lastMessage preview is the
              // raw __E2E__… blob. Decrypt it locally with the partner key
              // (ECDH is symmetric → works for both send/receive direction).
              const decrypted = tryDecryptDM(inc.lastMessage || '', inc.publicKey, myKey, myKey);
              const preview = decrypted.length > 50 ? decrypted.slice(0, 50) + '...' : decrypted;
              byKey.set(inc.publicKey, { ...inc, lastMessage: preview, unreadCount: prev?.unreadCount ?? inc.unreadCount ?? 0 });
            }
            const merged = [...byKey.values()].sort((a, b) => b.lastTimestamp - a.lastTimestamp);
            return { conversations: merged };
          });
          break;
        }

        // R25 — Phase 8. Sealed-sender delivery. Open the frame with our
        // Ed25519 seed, reveal the sender + plaintext, render + dedup by
        // messageId (shared with the legacy DM_MESSAGE path).
        case 'DM_DELIVER': {
          const p = msg.payload as any;
          const frameB64: string | undefined = p?.frame;
          if (typeof frameB64 !== 'string') break;
          const kp = getKeypair();
          if (!kp) break;
          const opened = openSealedDmFrame(frameB64, kp.privateKey);
          if (!opened) break; // not for us / corrupt
          const otherKey = opened.senderPubkey === myKey ? undefined : opened.senderPubkey;
          if (!otherKey) break; // our own echo — ignore (already optimistic)
          // Drop replays of deleted history (older than the delete watermark).
          if (opened.ts <= clearedAtFor(otherKey)) break;
          const senderName = opened.senderUsername || opened.senderPubkey.slice(0, 8);

          const dmMsg: DMMessage = {
            messageId: opened.messageId, content: opened.content,
            senderPublicKey: opened.senderPubkey, senderUsername: senderName,
            recipientPublicKey: myKey, timestamp: opened.ts,
            isOwn: false, encrypted: true,
            ...(opened.attachment ? {
              fileName: opened.attachment.name,
              mimeType: opened.attachment.mime,
              fileSize: opened.attachment.size,
              blobStatus: 'pending' as const,
              _attachment: opened.attachment,
            } : {}),
          };

          set((state) => {
            const existing = state.messages[otherKey] || [];
            if (existing.some((m) => m.messageId === dmMsg.messageId)) return state;
            return { messages: { ...state.messages, [otherKey]: [...existing, dmMsg].sort((a, b) => a.timestamp - b.timestamp) } };
          });

          // Auto-fetch the attachment (images/voice render inline; others
          // still resolve so the download is ready).
          if (opened.attachment) {
            void get().fetchDMAttachment(otherKey, opened.messageId);
          }

          dmDB.addMessage({
            messageId: opened.messageId,
            channel: `dm:${[myKey, otherKey].sort().join(':')}`,
            content: opened.content,
            senderPublicKey: opened.senderPubkey,
            senderUsername: senderName,
            timestamp: opened.ts, signature: '',
          });

          set((state) => {
            const convs = [...state.conversations];
            const idx = convs.findIndex((c) => c.publicKey === otherKey);
            const isActive = state.activeConversation === otherKey;
            const preview = opened.content.length > 50 ? opened.content.slice(0, 50) + '...' : opened.content;
            if (idx >= 0) {
              const prev = convs[idx]!;
              convs[idx] = { ...prev, lastMessage: preview, lastTimestamp: opened.ts, unreadCount: !isActive ? (prev.unreadCount || 0) + 1 : prev.unreadCount };
            } else {
              convs.unshift({ publicKey: otherKey, username: senderName, lastMessage: preview, lastTimestamp: opened.ts, unreadCount: !isActive ? 1 : 0 });
            }
            convs.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
            return { conversations: convs };
          });
          break;
        }
      }
    });

    return () => { clearInterval(inboxTimer); unsubscribe(); };
  },
}));

(window as any).__dm = useDMStore;