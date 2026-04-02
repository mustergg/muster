/**
 * File Upload Protocol Messages — R9
 *
 * ADD THIS FILE to packages/protocol/src/ and re-export from index.ts:
 *   export * from './file-messages.js';
 */

// =================================================================
// Client → Relay
// =================================================================

/** Upload a file attachment. Sent as base64 in a single message. */
export interface UploadFileMsg {
  type: 'UPLOAD_FILE';
  payload: {
    /** UUID for this file. */
    fileId: string;
    /** Channel or DM conversation this file belongs to. */
    channel: string;
    /** Original filename (e.g. "screenshot.png"). */
    fileName: string;
    /** MIME type (e.g. "image/png"). */
    mimeType: string;
    /** File size in bytes (before base64 encoding). */
    size: number;
    /** Base64-encoded file data. */
    data: string;
    /** Optional message text to accompany the file. */
    messageText?: string;
  };
  timestamp: number;
}

/** Request a file's data by ID. */
export interface RequestFileMsg {
  type: 'REQUEST_FILE';
  payload: {
    fileId: string;
  };
  timestamp: number;
}

// =================================================================
// Relay → Client(s)
// =================================================================

/** File was uploaded successfully. Broadcast to channel subscribers. */
export interface FileUploadedMsg {
  type: 'FILE_MESSAGE';
  payload: {
    messageId: string;
    channel: string;
    fileId: string;
    fileName: string;
    mimeType: string;
    size: number;
    senderPublicKey: string;
    senderUsername: string;
    messageText: string;
    timestamp: number;
  };
  timestamp: number;
}

/** File data response (for loading images/downloads). */
export interface FileDataMsg {
  type: 'FILE_DATA';
  payload: {
    fileId: string;
    fileName: string;
    mimeType: string;
    size: number;
    /** Base64-encoded file data. */
    data: string;
  };
  timestamp: number;
}

/** File upload rejected (too large, invalid type, etc). */
export interface FileRejectedMsg {
  type: 'FILE_REJECTED';
  payload: {
    fileId: string;
    reason: string;
  };
  timestamp: number;
}
