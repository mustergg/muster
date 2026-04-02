/**
 * File handler — processes file uploads and download requests.
 *
 * Handles: UPLOAD_FILE, REQUEST_FILE
 *
 * - Files are stored on the relay filesystem
 * - Metadata in SQLite
 * - File size limit: configurable, default 1MB
 * - Broadcasts FILE_MESSAGE to channel subscribers (like a message)
 */

import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { FileDB } from './fileDB';
import type { RelayClient } from './types';

/** Max file size in bytes. Default 1MB. */
const MAX_FILE_SIZE = parseInt(process.env.MUSTER_MAX_FILE_SIZE || '1048576', 10);

/** Allowed MIME type prefixes. */
const ALLOWED_TYPES = new Set([
  'image/', 'text/', 'application/pdf', 'application/json',
  'application/zip', 'application/x-zip-compressed',
  'audio/', 'video/',
]);

function isAllowedType(mimeType: string): boolean {
  if (!mimeType) return false;
  for (const prefix of ALLOWED_TYPES) {
    if (mimeType.startsWith(prefix)) return true;
  }
  return false;
}

export function handleFileMessage(
  client: RelayClient,
  msg: any,
  fileDB: FileDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
  channels: Map<string, Set<WebSocket>>,
): void {
  switch (msg.type) {
    case 'UPLOAD_FILE':
      handleUpload(client, msg, fileDB, sendToClient, clients, channels);
      break;
    case 'REQUEST_FILE':
      handleRequest(client, msg, fileDB, sendToClient);
      break;
  }
}

function handleUpload(
  client: RelayClient,
  msg: any,
  fileDB: FileDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
  clients: Map<WebSocket, RelayClient>,
  channels: Map<string, Set<WebSocket>>,
): void {
  const { fileId, channel, fileName, mimeType, size, data, messageText } = msg.payload || {};

  if (!fileId || !channel || !fileName || !mimeType || !data) {
    sendToClient(client, {
      type: 'FILE_REJECTED',
      payload: { fileId: fileId || '', reason: 'Missing required fields' },
      timestamp: Date.now(),
    });
    return;
  }

  // Check file size
  if (size > MAX_FILE_SIZE) {
    sendToClient(client, {
      type: 'FILE_REJECTED',
      payload: {
        fileId,
        reason: `File too large. Maximum size is ${Math.round(MAX_FILE_SIZE / 1024)}KB.`,
      },
      timestamp: Date.now(),
    });
    return;
  }

  // Validate MIME type
  if (!isAllowedType(mimeType)) {
    sendToClient(client, {
      type: 'FILE_REJECTED',
      payload: { fileId, reason: `File type "${mimeType}" is not allowed.` },
      timestamp: Date.now(),
    });
    return;
  }

  const timestamp = Date.now();
  const messageId = randomUUID();

  // Store file
  try {
    fileDB.storeFile(
      {
        fileId,
        channel,
        fileName,
        mimeType,
        size,
        senderPublicKey: client.publicKey,
        senderUsername: client.username,
        timestamp,
      },
      data,
    );
  } catch (err) {
    console.error('[relay] Failed to store file:', err);
    sendToClient(client, {
      type: 'FILE_REJECTED',
      payload: { fileId, reason: 'Server error storing file.' },
      timestamp: Date.now(),
    });
    return;
  }

  console.log(
    `[relay] File: ${client.username} uploaded "${fileName}" (${Math.round(size / 1024)}KB) to ${channel.slice(0, 8)}...`
  );

  // Broadcast FILE_MESSAGE to channel subscribers
  const fileMsg = {
    type: 'FILE_MESSAGE',
    payload: {
      messageId,
      channel,
      fileId,
      fileName,
      mimeType,
      size,
      senderPublicKey: client.publicKey,
      senderUsername: client.username,
      messageText: messageText || '',
      timestamp,
    },
    timestamp,
  };

  const outgoing = JSON.stringify(fileMsg);

  // Send to all subscribers of this channel (including sender for confirmation)
  const subs = channels.get(channel);
  if (subs) {
    for (const ws of subs) {
      if (ws.readyState === WebSocket.OPEN) ws.send(outgoing);
    }
  } else {
    // If not a channel, might be a DM — send to sender as confirmation
    sendToClient(client, fileMsg);
  }
}

function handleRequest(
  client: RelayClient,
  msg: any,
  fileDB: FileDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): void {
  const { fileId } = msg.payload || {};
  if (!fileId) return;

  const meta = fileDB.getFileMeta(fileId);
  if (!meta) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'FILE_NOT_FOUND', message: 'File not found' },
      timestamp: Date.now(),
    });
    return;
  }

  const data = fileDB.getFileData(fileId);
  if (!data) {
    sendToClient(client, {
      type: 'ERROR',
      payload: { code: 'FILE_NOT_FOUND', message: 'File data not available' },
      timestamp: Date.now(),
    });
    return;
  }

  sendToClient(client, {
    type: 'FILE_DATA',
    payload: {
      fileId,
      fileName: meta.fileName,
      mimeType: meta.mimeType,
      size: meta.size,
      data,
    },
    timestamp: Date.now(),
  });
}
