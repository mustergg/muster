/**
 * ChatArea — R9 update
 *
 * Changes:
 * - Added file upload button (paperclip icon) next to send
 * - FILE_MESSAGE events rendered inline (images displayed, files as download links)
 * - File picker with drag-and-drop support
 * - Files requested on demand and cached in memory
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore, type ChatMessage } from '../stores/chatStore.js';
import { useNetworkStore } from '../stores/networkStore.js';
import type { ActiveLocation } from '../pages/MainLayout.js';
import type { TransportMessage } from '@muster/transport';

interface Props {
  active: ActiveLocation | null;
}

/** Max file size: 1MB */
const MAX_FILE_SIZE = 1 * 1024 * 1024;

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ─── File message component ────────────────────────────────────────────

function FileAttachment({ fileId, fileName, mimeType, size }: {
  fileId: string; fileName: string; mimeType: string; size: number;
}): React.JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const isImage = mimeType.startsWith('image/');

  const loadFile = useCallback(() => {
    if (dataUrl || loading) return;
    setLoading(true);

    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) { setError(true); setLoading(false); return; }

    const cleanup = useNetworkStore.getState().onMessage((msg: TransportMessage) => {
      if (msg.type === 'FILE_DATA' && (msg.payload as any).fileId === fileId) {
        cleanup();
        const p = msg.payload as any;
        setDataUrl(`data:${p.mimeType};base64,${p.data}`);
        setLoading(false);
      }
      if (msg.type === 'ERROR' && (msg.payload as any).code === 'FILE_NOT_FOUND') {
        cleanup();
        setError(true);
        setLoading(false);
      }
    });

    transport.send({ type: 'REQUEST_FILE', payload: { fileId }, timestamp: Date.now() });

    // Timeout
    setTimeout(() => { if (loading) { cleanup(); setError(true); setLoading(false); } }, 15000);
  }, [fileId, dataUrl, loading]);

  // Auto-load images
  useEffect(() => {
    if (isImage) loadFile();
  }, [isImage]);

  if (isImage) {
    if (loading) return <div style={fileStyles.imagePlaceholder}>Loading image...</div>;
    if (error) return <div style={fileStyles.imagePlaceholder}>Failed to load image</div>;
    if (dataUrl) {
      const handleImageClick = () => {
        try {
          const parts = dataUrl.split(',');
          const mime = parts[0]?.match(/:(.*?);/)?.[1] || mimeType;
          const raw = atob(parts[1] || '');
          const arr = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
          const blob = new Blob([arr], { type: mime });
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        } catch { /* fallback */ }
      };
      return (
        <div style={fileStyles.imageWrap}>
          <img
            src={dataUrl}
            alt={fileName}
            style={fileStyles.image}
            onClick={handleImageClick}
            title="Click to download"
          />
          <span style={fileStyles.imageLabel}>{fileName} ({formatSize(size)})</span>
        </div>
      );
    }
    return <></>;
  }

  // Non-image file
  return (
    <div style={fileStyles.fileCard}>
      <div style={fileStyles.fileIcon}>&#x1F4CE;</div>
      <div style={fileStyles.fileMeta}>
        <span style={fileStyles.fileName}>{fileName}</span>
        <span style={fileStyles.fileSize}>{formatSize(size)}</span>
      </div>
      <button
        onClick={() => {
          if (dataUrl) {
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = fileName;
            a.click();
          } else {
            loadFile();
          }
        }}
        style={fileStyles.downloadBtn}
      >
        {loading ? '...' : dataUrl ? '\u2B07' : '\u2B07'}
      </button>
    </div>
  );
}

const fileStyles = {
  imagePlaceholder: { padding: '12px', background: 'var(--color-bg-hover)', borderRadius: '8px', fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px' } as React.CSSProperties,
  imageWrap: { marginTop: '6px', display: 'flex', flexDirection: 'column' as const, gap: '4px' } as React.CSSProperties,
  image: { maxWidth: '400px', maxHeight: '300px', borderRadius: '8px', cursor: 'pointer', objectFit: 'contain' as const, border: '1px solid var(--color-border)' } as React.CSSProperties,
  imageLabel: { fontSize: '10px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' } as React.CSSProperties,
  fileCard: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'var(--color-bg-hover)', borderRadius: '8px', marginTop: '6px', maxWidth: '320px' } as React.CSSProperties,
  fileIcon: { fontSize: '20px', flexShrink: 0 } as React.CSSProperties,
  fileMeta: { flex: 1, display: 'flex', flexDirection: 'column' as const, minWidth: 0 } as React.CSSProperties,
  fileName: { fontSize: '13px', color: 'var(--color-accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } as React.CSSProperties,
  fileSize: { fontSize: '10px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' } as React.CSSProperties,
  downloadBtn: { width: '28px', height: '28px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } as React.CSSProperties,
};

// ─── Message row ────────────────────────────────────────────────────────

function MessageRow({ msg }: { msg: ChatMessage }): React.JSX.Element {
  const initials = (msg.senderUsername || '??').slice(0, 2).toUpperCase();
  const hue = parseInt((msg.senderPublicKey || '0000').slice(0, 4), 16) % 360;

  const hasFile = !!(msg as any).fileId;

  return (
    <div style={styles.msgGroup}>
      <div style={{ ...styles.avatar, background: `hsl(${hue},45%,25%)`, color: `hsl(${hue},75%,72%)` }}>
        {initials}
      </div>
      <div style={styles.msgBody}>
        <div style={styles.msgHeader}>
          <span style={{ ...styles.author, color: `hsl(${hue},75%,72%)` }}>
            {msg.senderUsername}
          </span>
          <span style={styles.time}>{formatTime(msg.timestamp)}</span>
        </div>
        {msg.content && <p style={styles.content}>{msg.content}</p>}
        {hasFile && (
          <FileAttachment
            fileId={(msg as any).fileId}
            fileName={(msg as any).fileName}
            mimeType={(msg as any).mimeType}
            size={(msg as any).fileSize}
          />
        )}
      </div>
    </div>
  );
}

// ─── Main ChatArea ──────────────────────────────────────────────────────

export default function ChatArea({ active }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { messages, subscribe, unsubscribe, sendMessage } = useChatStore();
  const [draft, setDraft] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!active) return;
    subscribe([active.channelId]);
    return () => unsubscribe([active.channelId]);
  }, [active?.communityId, active?.channelId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [active?.channelId, messages]);

  const handleSend = async (): Promise<void> => {
    if (!active || !draft.trim()) return;
    const content = draft.trim();
    setDraft('');
    await sendMessage(active.channelId, content);
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const uploadFile = useCallback(async (file: File) => {
    if (!active) return;
    if (file.size > MAX_FILE_SIZE) {
      alert(`File too large. Maximum size is ${formatSize(MAX_FILE_SIZE)}.`);
      return;
    }

    setUploading(true);

    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1] || '');
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      const { transport } = useNetworkStore.getState();
      if (!transport?.isConnected) {
        alert('Not connected to relay.');
        return;
      }

      transport.send({
        type: 'UPLOAD_FILE',
        payload: {
          fileId: uuid(),
          channel: active.channelId,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          data: base64,
          messageText: draft.trim() || undefined,
        },
        timestamp: Date.now(),
      });

      setDraft('');
    } catch (err) {
      console.error('[chat] Upload failed:', err);
      alert('Failed to upload file.');
    } finally {
      setUploading(false);
    }
  }, [active, draft]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = ''; // Reset for re-selection
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }, [uploadFile]);

  if (!active) {
    return (
      <div style={styles.empty}>
        <span style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>
          Select a channel to start chatting
        </span>
      </div>
    );
  }

  const channelMessages = messages[active.channelId] ?? [];

  return (
    <div
      style={styles.container}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerIcon}>#</span>
        <span style={styles.headerName}>{active.channelName}</span>
      </div>

      {/* Drag overlay */}
      {dragOver && (
        <div style={styles.dragOverlay}>
          <div style={styles.dragContent}>
            <span style={styles.dragIcon}>&#x1F4CE;</span>
            <span style={styles.dragText}>Drop file to upload</span>
          </div>
        </div>
      )}

      {/* Messages */}
      <div style={styles.messages}>
        {channelMessages.length === 0 && (
          <div style={styles.emptyChannel}>
            {t('channel.emptyHistory', { name: active.channelName })}
          </div>
        )}
        {channelMessages.map((msg) => (
          <MessageRow key={msg.messageId} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={styles.inputArea}>
        <div style={styles.inputWrap}>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={styles.attachBtn}
            title="Attach file"
          >
            {uploading ? '\u231B' : '\u{1F4CE}'}
          </button>
          <input
            style={styles.input}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('channel.textPlaceholder', { name: active.channelName })}
            disabled={uploading}
          />
          <button
            onClick={handleSend}
            disabled={!draft.trim() || uploading}
            style={styles.sendBtn}
          >
            &#x2191;
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
      </div>
    </div>
  );
}

const styles = {
  container: { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', position: 'relative' as const } as React.CSSProperties,
  empty: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' } as React.CSSProperties,
  header: { height: '48px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: '8px', flexShrink: 0 } as React.CSSProperties,
  headerIcon: { fontFamily: 'var(--font-mono)', fontSize: '16px', color: 'var(--color-text-muted)' } as React.CSSProperties,
  headerName: { fontSize: '15px', fontWeight: 600 } as React.CSSProperties,
  messages: { flex: 1, overflowY: 'auto' as const, padding: '16px', display: 'flex', flexDirection: 'column' as const, gap: '4px' } as React.CSSProperties,
  emptyChannel: { fontSize: '13px', color: 'var(--color-text-muted)', padding: '8px 0' } as React.CSSProperties,
  msgGroup: { display: 'flex', gap: '12px', padding: '2px 0', marginBottom: '8px' } as React.CSSProperties,
  avatar: { width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, flexShrink: 0, alignSelf: 'flex-start' as const, marginTop: '2px' } as React.CSSProperties,
  msgBody: { flex: 1, minWidth: 0 } as React.CSSProperties,
  msgHeader: { display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '2px' } as React.CSSProperties,
  author: { fontSize: '14px', fontWeight: 600 } as React.CSSProperties,
  time: { fontSize: '11px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' } as React.CSSProperties,
  content: { fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.5, wordBreak: 'break-word' as const } as React.CSSProperties,
  inputArea: { padding: '10px 16px 14px', flexShrink: 0 } as React.CSSProperties,
  inputWrap: { display: 'flex', alignItems: 'center', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: '10px', gap: '4px', paddingRight: '8px', paddingLeft: '4px' } as React.CSSProperties,
  attachBtn: { width: '32px', height: '32px', borderRadius: '6px', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'color 0.15s' } as React.CSSProperties,
  input: { flex: 1, background: 'transparent', border: 'none', color: 'var(--color-text-primary)', padding: '10px 8px', outline: 'none', fontSize: '13px', fontFamily: 'inherit' } as React.CSSProperties,
  sendBtn: { width: '30px', height: '30px', borderRadius: '6px', background: 'var(--color-accent)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: 1, transition: 'opacity 0.15s' } as React.CSSProperties,
  dragOverlay: { position: 'absolute' as const, inset: 0, background: 'rgba(79, 142, 247, 0.08)', border: '2px dashed var(--color-accent)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 } as React.CSSProperties,
  dragContent: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '8px' } as React.CSSProperties,
  dragIcon: { fontSize: '32px' } as React.CSSProperties,
  dragText: { fontSize: '14px', color: 'var(--color-accent)', fontWeight: 500 } as React.CSSProperties,
} as const;
