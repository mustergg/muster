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
import { buildSealedDmFrame, openSealedDmFrame } from '../lib/sealedDm';
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
}

export interface DMConversation {
  publicKey: string; username: string; lastMessage: string; lastTimestamp: number; unreadCount: number;
}

interface DMState {
  messages: Record<string, DMMessage[]>;
  conversations: DMConversation[];
  activeConversation: string | null;
  sendDM: (recipientPublicKey: string, content: string) => void;
  openConversation: (publicKey: string) => void;
  loadConversations: () => void;
  setActiveConversation: (publicKey: string | null) => void;
  clearConversation: (publicKey: string) => void;
  /** R25 — Phase 8. (Re)subscribe to our rotating inbox hashes. */
  subscribeInbox: () => void;
  init: () => () => void;
}

const dmDB = new BrowserDB();

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

  openConversation: (publicKey) => {
    set((state) => ({
      activeConversation: publicKey,
      conversations: state.conversations.map((c) =>
        c.publicKey === publicKey ? { ...c, unreadCount: 0 } : c
      ),
    }));
    const network = useNetworkStore.getState();
    if (!network.transport?.isConnected) return;
    network.transport.send({ type: 'DM_HISTORY_REQUEST', payload: { otherPublicKey: publicKey, since: 0 }, timestamp: Date.now() });
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
    set((state) => ({
      messages: (() => { const m = { ...state.messages }; delete m[publicKey]; return m; })(),
      conversations: state.conversations.filter((c) => c.publicKey !== publicKey),
      activeConversation: state.activeConversation === publicKey ? null : state.activeConversation,
    }));
    const myKey = useNetworkStore.getState().publicKey;
    const channelKey = `dm:${[myKey, publicKey].sort().join(':')}`;
    dmDB.clearChannel(channelKey);
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

    const unsubscribe = network.onMessage((msg: TransportMessage) => {
      switch (msg.type) {
        case 'DM_MESSAGE': {
          const p = msg.payload as any;
          const otherKey = p.senderPublicKey === myKey ? p.recipientPublicKey : p.senderPublicKey;
          const isOwn = p.senderPublicKey === myKey;

          // Decrypt the message content
          const decryptedContent = tryDecryptDM(p.content, p.senderPublicKey, p.recipientPublicKey, myKey);
          const encrypted = isE2EEncrypted(p.content);

          const dmMsg: DMMessage = {
            messageId: p.messageId, content: decryptedContent,
            senderPublicKey: p.senderPublicKey, senderUsername: p.senderUsername,
            recipientPublicKey: p.recipientPublicKey, timestamp: p.timestamp,
            isOwn, encrypted,
          };

          set((state) => {
            const existing = state.messages[otherKey] || [];
            if (existing.some((m) => m.messageId === dmMsg.messageId)) return state;
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

        case 'DM_HISTORY_RESPONSE': {
          const p = msg.payload as any;
          const msgs: DMMessage[] = (p.messages || []).map((m: any) => {
            const decrypted = tryDecryptDM(m.content, m.senderPublicKey, m.recipientPublicKey, myKey);
            return {
              messageId: m.messageId, content: decrypted,
              senderPublicKey: m.senderPublicKey, senderUsername: m.senderUsername,
              recipientPublicKey: m.recipientPublicKey, timestamp: m.timestamp,
              isOwn: m.senderPublicKey === myKey, encrypted: isE2EEncrypted(m.content),
            };
          });
          set((state) => ({ messages: { ...state.messages, [p.otherPublicKey]: msgs } }));
          break;
        }

        case 'DM_CONVERSATIONS_RESPONSE': {
          const p = msg.payload as any;
          set({ conversations: p.conversations || [] });
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

          const dmMsg: DMMessage = {
            messageId: opened.messageId, content: opened.content,
            senderPublicKey: opened.senderPubkey, senderUsername: opened.senderPubkey.slice(0, 8),
            recipientPublicKey: myKey, timestamp: opened.ts,
            isOwn: false, encrypted: true,
          };

          set((state) => {
            const existing = state.messages[otherKey] || [];
            if (existing.some((m) => m.messageId === dmMsg.messageId)) return state;
            return { messages: { ...state.messages, [otherKey]: [...existing, dmMsg].sort((a, b) => a.timestamp - b.timestamp) } };
          });

          dmDB.addMessage({
            messageId: opened.messageId,
            channel: `dm:${[myKey, otherKey].sort().join(':')}`,
            content: opened.content,
            senderPublicKey: opened.senderPubkey,
            senderUsername: opened.senderPubkey.slice(0, 8),
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
              convs.unshift({ publicKey: otherKey, username: opened.senderPubkey.slice(0, 8), lastMessage: preview, lastTimestamp: opened.ts, unreadCount: !isActive ? 1 : 0 });
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