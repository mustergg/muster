/**
 * DM handler — R5b fix
 *
 * Fixes:
 * - Stores recipientUsername when sending DMs (for conversation list display)
 * - Resolves usernames from connected clients for conversation list
 */

import { WebSocket } from 'ws';
import { DMDB } from './dmDB';
import type { RelayClient } from './types';

export function handleDMMessage(
  client: RelayClient,
  msg: any,
  dmDB: DMDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  switch (msg.type) {
    case 'SEND_DM':
      handleSendDM(client, msg, dmDB, sendToClient, clients);
      break;
    case 'DM_HISTORY_REQUEST':
      handleDMHistory(client, msg, dmDB, sendToClient);
      break;
    case 'DELETE_DM':
      handleDeleteDM(client, msg, dmDB, sendToClient, clients);
      break;
    case 'EDIT_DM':
      handleEditDM(client, msg, dmDB, sendToClient, clients);
      break;
  }
}

function handleSendDM(
  client: RelayClient,
  msg: any,
  dmDB: DMDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  const { recipientPublicKey, content, messageId, timestamp } = msg.payload || {};

  if (!recipientPublicKey || !content || !messageId) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'INVALID_DM', message: 'Missing recipientPublicKey, content, or messageId' },
      timestamp: Date.now(),
    });
    return;
  }

  // Resolve recipient username from connected clients
  let recipientUsername = '';
  for (const [, c] of clients) {
    if (c.authenticated && c.publicKey === recipientPublicKey) {
      recipientUsername = c.username;
      break;
    }
  }

  // Store the DM with both sender and recipient usernames
  dmDB.storeMessage({
    messageId,
    senderPublicKey: client.publicKey,
    senderUsername: client.username,
    recipientPublicKey,
    recipientUsername,
    content,
    timestamp,
    signature: msg.signature || '',
  });

  console.log(
    `[relay] DM: ${client.username} → ${recipientUsername || recipientPublicKey.slice(0, 8)}...`
  );

  const dmMsg = {
    type: 'DM_MESSAGE',
    payload: {
      messageId,
      content,
      senderPublicKey: client.publicKey,
      senderUsername: client.username,
      recipientPublicKey,
      recipientUsername,
      timestamp,
    },
    signature: msg.signature || '',
  };

  // Deliver to recipient if online
  let delivered = false;
  for (const [ws, c] of clients) {
    if (c.authenticated && c.publicKey === recipientPublicKey && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(dmMsg));
      delivered = true;
    }
  }

  // Also send back to sender
  sendToClient(client, dmMsg);

  if (!delivered) {
    console.log(`[relay] DM queued for offline: ${recipientPublicKey.slice(0, 8)}...`);
  }
}

const DM_EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Deliver a payload to both parties of a DM (sender already via sendToClient). */
function notifyBoth(
  client: RelayClient, otherPublicKey: string, payload: Record<string, unknown>,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  sendToClient(client, payload);
  const str = JSON.stringify(payload);
  for (const [ws, c] of clients) {
    if (c.authenticated && c.publicKey === otherPublicKey && ws.readyState === WebSocket.OPEN) ws.send(str);
  }
}

function handleDeleteDM(
  client: RelayClient, msg: any, dmDB: DMDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  const { messageId } = msg.payload || {};
  if (!messageId) return;
  const m = dmDB.getMessage(messageId);
  if (!m) return;
  // Only the sender may delete their own message.
  if (m.senderPublicKey !== client.publicKey) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'FORBIDDEN', message: 'You can only delete your own DMs.' }, timestamp: Date.now() });
    return;
  }
  dmDB.deleteMessage(messageId);
  const other = m.recipientPublicKey;
  notifyBoth(client, other, {
    type: 'DM_DELETED',
    payload: { messageId, senderPublicKey: m.senderPublicKey, recipientPublicKey: m.recipientPublicKey },
    timestamp: Date.now(),
  }, sendToClient, clients);
}

function handleEditDM(
  client: RelayClient, msg: any, dmDB: DMDB,
  sendToClient: (c: RelayClient, m: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  const { messageId, content } = msg.payload || {};
  if (!messageId || typeof content !== 'string') return;
  const m = dmDB.getMessage(messageId);
  if (!m) return;
  if (m.senderPublicKey !== client.publicKey) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'FORBIDDEN', message: 'You can only edit your own DMs.' }, timestamp: Date.now() });
    return;
  }
  if (Date.now() - m.timestamp > DM_EDIT_WINDOW_MS) {
    sendToClient(client, { type: 'ERROR', payload: { code: 'FORBIDDEN', message: 'The edit window for this message has passed.' }, timestamp: Date.now() });
    return;
  }
  dmDB.updateMessageContent(messageId, content);
  notifyBoth(client, m.recipientPublicKey, {
    type: 'DM_EDITED',
    payload: { messageId, content, senderPublicKey: m.senderPublicKey, recipientPublicKey: m.recipientPublicKey },
    timestamp: Date.now(),
  }, sendToClient, clients);
}

function handleDMHistory(
  client: RelayClient,
  msg: any,
  dmDB: DMDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): void {
  const { otherPublicKey, since } = msg.payload || {};
  if (!otherPublicKey) return;

  const messages = dmDB.getHistory(client.publicKey, otherPublicKey, since || 0);

  sendToClient(client, {
    type: 'DM_HISTORY_RESPONSE',
    payload: {
      otherPublicKey,
      messages: messages.map((m) => ({
        messageId: m.messageId,
        content: m.content,
        senderPublicKey: m.senderPublicKey,
        senderUsername: m.senderUsername,
        recipientPublicKey: m.recipientPublicKey,
        timestamp: m.timestamp,
      })),
    },
    timestamp: Date.now(),
  });
}

function handleDMConversations(
  client: RelayClient,
  dmDB: DMDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
): void {
  const conversations = dmDB.getConversations(client.publicKey);

  // Resolve any missing usernames from currently connected clients
  for (const conv of conversations) {
    if (!conv.username || conv.username.endsWith('...')) {
      for (const [, c] of clients) {
        if (c.authenticated && c.publicKey === conv.publicKey) {
          conv.username = c.username;
          break;
        }
      }
    }
  }

  sendToClient(client, {
    type: 'DM_CONVERSATIONS_RESPONSE',
    payload: {
      conversations: conversations.map((c) => ({
        ...c,
        unreadCount: 0,
      })),
    },
    timestamp: Date.now(),
  });
}
