/**
 * DMChatArea — chat area for direct messages.
 * Similar to ChatArea but uses dmStore instead of chatStore.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useDMStore, type DMMessage } from '../stores/dmStore.js';
import { useNetworkStore } from '../stores/networkStore.js';
import EmojiPicker from './EmojiPicker.js';
import VoiceRecorder from './VoiceRecorder.js';
import { ReceiptToggle, SeenIndicator, MarkSeenButton } from './ReadReceiptUI.js';
import { parseReply, packReply, replyPreview, mentionsUser, flashMessage, isFirstMentionView } from '../lib/messageFx.js';
import { useReadReceiptStore } from '../stores/readReceiptStore.js';

interface Props {
  /** Public key of the conversation partner. */
  partnerPublicKey: string | null;
}

/** Max DM attachment size (content-addressed pieces). */
const MAX_DM_FILE = 100 * 1024 * 1024;

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

function DMAttachment({ msg }: { msg: DMMessage }): React.JSX.Element {
  const fetchDMAttachment = useDMStore((s) => s.fetchDMAttachment);
  const mime = msg.mimeType || '';
  const isImage = mime.startsWith('image/');
  const isAudio = mime.startsWith('audio/');
  const status = msg.blobStatus ?? 'pending';
  const url = msg.attachmentUrl;
  const name = msg.fileName || 'attachment';
  const size = msg.fileSize || 0;
  const partnerKey = msg.isOwn ? msg.recipientPublicKey : msg.senderPublicKey;

  useEffect(() => {
    if ((isImage || isAudio) && status === 'pending') void fetchDMAttachment(partnerKey, msg.messageId);
  }, [isImage, isAudio, status, partnerKey, msg.messageId]);
  const download = () => {
    if (!url) { void fetchDMAttachment(partnerKey, msg.messageId); return; }
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  if (isImage) {
    if (status === 'loading' || status === 'pending') return <div style={fileStyles.placeholder}>Loading image…</div>;
    if (status === 'failed') return <div style={fileStyles.placeholder}>Failed to load image</div>;
    if (url) return (
      <div style={fileStyles.imageWrap}>
        <img src={url} alt={name} style={fileStyles.image} onClick={download} />
        <span style={fileStyles.label}>{name} ({formatSize(size)})</span>
      </div>
    );
    return <></>;
  }
  if (isAudio) {
    if (status === 'loading' || status === 'pending') return <div style={fileStyles.placeholder}>{'\u{1F3A4}'} Loading voice note…</div>;
    if (status === 'failed') return <div style={fileStyles.placeholder}>Failed to load voice note</div>;
    if (url) return (
      <div style={fileStyles.imageWrap}>
        <audio src={url} controls style={{ maxWidth: '320px' }} />
        <span style={fileStyles.label}>{'\u{1F3A4}'} {formatSize(size)}</span>
      </div>
    );
    return <></>;
  }
  return (
    <div style={fileStyles.fileCard}>
      <div style={fileStyles.fileIcon}>&#x1F4CE;</div>
      <div style={fileStyles.fileMeta}>
        <span style={fileStyles.fileName}>{name}</span>
        <span style={fileStyles.fileSize}>{formatSize(size)}{status === 'failed' ? ' · failed' : ''}</span>
      </div>
      <button onClick={download} style={fileStyles.downloadBtn}>{status === 'loading' ? '…' : '⬇'}</button>
    </div>
  );
}

const DM_EDIT_WINDOW_MS = 15 * 60 * 1000;

function DMMessageRow({ msg, ctxId, partnerKey, myUsername, myKey, onReply, resolveReply }: { msg: DMMessage; ctxId: string; partnerKey: string; myUsername: string; myKey: string; onReply: (msg: DMMessage) => void; resolveReply: (id: string) => { username: string; preview: string } | null }): React.JSX.Element {
  const hue = parseInt((msg.senderPublicKey || '0000').slice(0, 4), 16) % 360;
  const initials = (msg.senderUsername || '??').slice(0, 2).toUpperCase();
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const deleteDM = useDMStore((s) => s.deleteDM);
  const editDM = useDMStore((s) => s.editDM);
  const hasAttachment = !!msg._attachment || !!msg.attachmentUrl;
  const within = (Date.now() - msg.timestamp) <= DM_EDIT_WINDOW_MS;
  const canDelete = msg.isOwn && within;
  const canEdit = msg.isOwn && within && !hasAttachment;

  const { replyTo, text } = parseReply(msg.content || '');
  const repliedTo = replyTo ? resolveReply(replyTo) : null;
  const mentioned = mentionsUser(text, myUsername);

  useEffect(() => {
    if (mentioned && !msg.isOwn && isFirstMentionView(myKey, msg.messageId)) {
      setTimeout(() => flashMessage(msg.messageId), 120);
    }
  }, []);

  const saveEdit = (): void => {
    const v = editDraft.trim();
    setEditing(false);
    if (v && v !== text) editDM(partnerKey, msg.messageId, replyTo ? packReply(replyTo, v) : v);
  };

  return (
    <div id={`msg-${msg.messageId}`} style={{ ...styles.msgGroup, ...(msg.isOwn ? { flexDirection: 'row-reverse' as const } : {}) }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={{ ...styles.avatar, background: `hsl(${hue},45%,25%)`, color: `hsl(${hue},75%,72%)` }}>
        {initials}
      </div>
      <div style={{ ...styles.msgBody, ...(msg.isOwn ? { display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end', textAlign: 'right' as const } : {}) }}>
        {repliedTo && (
          <button style={dmEdit.replyChip} onClick={() => replyTo && flashMessage(replyTo)} title="Jump to message">
            {'↪'} {repliedTo.username}: {repliedTo.preview}
          </button>
        )}
        <div style={styles.msgHeader}>
          <span style={{ ...styles.author, color: `hsl(${hue},75%,72%)` }}>
            {msg.senderUsername}
          </span>
          <span style={styles.time}>{formatTime(msg.timestamp)}{msg.edited ? ' (edited)' : ''}</span>
          {msg.isOwn && <SeenIndicator context="dm" contextId={ctxId} messageId={msg.messageId} />}
          {!msg.isOwn && hover && <MarkSeenButton context="dm" contextId={ctxId} messageId={msg.messageId} to={partnerKey} />}
        </div>
        {editing ? (
          <div style={dmEdit.row}>
            <input
              autoFocus
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } else if (e.key === 'Escape') setEditing(false); }}
              style={dmEdit.input}
            />
            <button onClick={saveEdit} style={dmEdit.save}>Save</button>
            <button onClick={() => setEditing(false)} style={dmEdit.cancel}>Cancel</button>
          </div>
        ) : (
          text && <p style={{ ...styles.content, ...(mentioned ? { fontWeight: 700, color: 'var(--color-text-primary)' } : {}) }}>{text}</p>
        )}
        {hasAttachment && <DMAttachment msg={msg} />}
      </div>
      {!editing && hover && (
        <div style={dmEdit.actions}>
          <button onClick={() => onReply(msg)} style={dmEdit.actionBtn} title="Reply">{'↩️'}</button>
          {canEdit && <button onClick={() => { setEditDraft(text); setEditing(true); }} style={dmEdit.actionBtn} title="Edit message">{'✏️'}</button>}
          {canDelete && <button onClick={() => { if (confirm('Delete this message?')) deleteDM(partnerKey, msg.messageId); }} style={dmEdit.actionBtn} title="Delete message">{'\u{1F5D1}'}</button>}
        </div>
      )}
    </div>
  );
}

const dmEdit = {
  replyChip: { display: 'inline-flex', alignItems: 'center', gap: '4px', maxWidth: '100%', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', fontSize: '11px', cursor: 'pointer', padding: '1px 0', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, textAlign: 'left' as const } as React.CSSProperties,
  actions: { position: 'absolute' as const, top: '0', right: '4px', display: 'flex', gap: '3px' } as React.CSSProperties,
  actionBtn: { width: '24px', height: '24px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' } as React.CSSProperties,
  row: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '2px' } as React.CSSProperties,
  input: { flex: 1, padding: '6px 10px', background: 'var(--color-bg-input)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', fontSize: '14px', outline: 'none', fontFamily: 'inherit' } as React.CSSProperties,
  save: { padding: '5px 10px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  cancel: { padding: '5px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: '11px', cursor: 'pointer' } as React.CSSProperties,
  replyBar: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-md)', marginBottom: '6px' } as React.CSSProperties,
  replyBarText: { flex: 1, fontSize: '12px', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } as React.CSSProperties,
  replyBarClose: { background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '12px', flexShrink: 0 } as React.CSSProperties,
} as const;

const fileStyles = {
  placeholder: { padding: '12px', background: 'var(--color-bg-hover)', borderRadius: '8px', fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px' } as React.CSSProperties,
  imageWrap: { marginTop: '6px', display: 'flex', flexDirection: 'column' as const, gap: '4px' } as React.CSSProperties,
  image: { maxWidth: '400px', maxHeight: '300px', borderRadius: '8px', cursor: 'pointer', objectFit: 'contain' as const, border: '1px solid var(--color-border)' } as React.CSSProperties,
  label: { fontSize: '10px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' } as React.CSSProperties,
  fileCard: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'var(--color-bg-hover)', borderRadius: '8px', marginTop: '6px', maxWidth: '320px' } as React.CSSProperties,
  fileIcon: { fontSize: '20px', flexShrink: 0 } as React.CSSProperties,
  fileMeta: { flex: 1, display: 'flex', flexDirection: 'column' as const, minWidth: 0 } as React.CSSProperties,
  fileName: { fontSize: '13px', color: 'var(--color-accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } as React.CSSProperties,
  fileSize: { fontSize: '10px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' } as React.CSSProperties,
  downloadBtn: { width: '28px', height: '28px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } as React.CSSProperties,
} as const;

export default function DMChatArea({ partnerPublicKey }: Props): React.JSX.Element {
  const { messages, sendDM, sendDMFile, openConversation, conversations } = useDMStore();
  const { publicKey: myKey, username: myUsername } = useNetworkStore();
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<{ messageId: string; preview: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const uploadFile = useCallback(async (file: File) => {
    if (!partnerPublicKey) return;
    if (file.size > MAX_DM_FILE) { alert(`File too large. Max ${formatSize(MAX_DM_FILE)}.`); return; }
    setUploading(true);
    try { await sendDMFile(partnerPublicKey, file); }
    catch (err) { console.error('[dm] upload failed:', err); alert('Failed to send file.'); }
    finally { setUploading(false); }
  }, [partnerPublicKey, sendDMFile]);

  const hasFiles = (e: React.DragEvent): boolean => Array.from(e.dataTransfer?.types || []).includes('Files');
  const onDragEnter = useCallback((e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepthRef.current += 1; setDragOver(true); }, []);
  const onDragOver = useCallback((e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => { if (!hasFiles(e)) return; dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (dragDepthRef.current === 0) setDragOver(false); }, []);
  const onDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); dragDepthRef.current = 0; setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void uploadFile(f); }, [uploadFile]);

  // Load conversation on mount / partner change
  useEffect(() => {
    if (partnerPublicKey) {
      openConversation(partnerPublicKey);
    }
  }, [partnerPublicKey]);

  // Auto-scroll
  const dmMessages = partnerPublicKey ? (messages[partnerPublicKey] || []) : [];
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [dmMessages.length]);

  // Auto-send read receipts for the partner's messages when enabled.
  useEffect(() => {
    if (!partnerPublicKey) return;
    const ctxId = `dm:${[myKey, partnerPublicKey].sort().join(':')}`;
    const ack = useReadReceiptStore.getState().ack;
    for (const m of dmMessages) {
      if (!m.isOwn) ack('dm', ctxId, m.messageId, m.timestamp, partnerPublicKey);
    }
  }, [partnerPublicKey, myKey, dmMessages.length]);

  const handleSend = (): void => {
    if (!partnerPublicKey || !draft.trim()) return;
    const body = draft.trim();
    sendDM(partnerPublicKey, replyTo ? packReply(replyTo.messageId, body) : body);
    setDraft('');
    setReplyTo(null);
  };

  const resolveReply = (id: string): { username: string; preview: string } | null => {
    const orig = dmMessages.find((m) => m.messageId === id);
    if (!orig) return null;
    return { username: orig.senderUsername, preview: replyPreview(orig.content, 99) };
  };
  const startReply = (m: DMMessage): void => setReplyTo({ messageId: m.messageId, preview: replyPreview(m.content, 80) });

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!partnerPublicKey) {
    return (
      <div style={styles.empty}>
        <div style={styles.emptyContent}>
          <span style={styles.emptyIcon}>DM</span>
          <span style={styles.emptyText}>Select a conversation or start a new one</span>
          <span style={styles.emptyHint}>Click DM next to a member's name in any community</span>
        </div>
      </div>
    );
  }

  // Find partner username from conversations or messages
  const conv = conversations.find((c) => c.publicKey === partnerPublicKey);
  const partnerName = conv?.username
    || dmMessages.find((m) => m.senderPublicKey === partnerPublicKey)?.senderUsername
    || partnerPublicKey.slice(0, 12) + '...';

  const partnerHue = parseInt((partnerPublicKey || '0000').slice(0, 4), 16) % 360;
  const dmCtxId = `dm:${[myKey, partnerPublicKey].sort().join(':')}`;

  return (
    <div style={styles.container} onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {dragOver && (
        <div style={styles.dragOverlay}>
          <div style={styles.dragContent}><span style={{ fontSize: '32px' }}>&#x1F4CE;</span><span>Drop file to send</span></div>
        </div>
      )}
      {/* Header */}
      <div style={styles.header}>
        <div style={{ ...styles.headerAvatar, background: `hsl(${partnerHue},40%,20%)`, color: `hsl(${partnerHue},70%,65%)` }}>
          {(partnerName || '??').slice(0, 2).toUpperCase()}
        </div>
        <span style={styles.headerName}>{partnerName}</span>
        <div style={{ flex: 1 }} />
        <ReceiptToggle context="dm" contextId={dmCtxId} />
      </div>

      {/* Messages */}
      <div style={styles.messages}>
        {dmMessages.length === 0 && (
          <div style={styles.emptyChannel}>
            This is the beginning of your conversation with {partnerName}.
          </div>
        )}
        {dmMessages.map((msg) => (
          <DMMessageRow key={msg.messageId} msg={msg} ctxId={dmCtxId} partnerKey={partnerPublicKey} myUsername={myUsername || ''} myKey={myKey} onReply={startReply} resolveReply={resolveReply} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={styles.inputArea}>
        {replyTo && (
          <div style={dmEdit.replyBar}>
            <span style={dmEdit.replyBarText}>{'↩️'} Replying to: {replyTo.preview}</span>
            <button onClick={() => setReplyTo(null)} style={dmEdit.replyBarClose} title="Cancel reply">{'✕'}</button>
          </div>
        )}
        <div style={styles.inputWrap}>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={styles.iconBtn}
            title="Attach file"
          >
            {uploading ? '⌛' : '\u{1F4CE}'}
          </button>
          <VoiceRecorder onSend={(f) => void uploadFile(f)} disabled={uploading} />
          <input
            style={styles.input}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${partnerName}`}
          />
          <EmojiPicker onPick={(e) => setDraft((d) => d + e)} />
          <button onClick={handleSend} disabled={!draft.trim()} style={styles.sendBtn}>
            &#x2191;
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ''; }}
        />
      </div>
    </div>
  );
}

const styles = {
  container: { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', position: 'relative' as const } as React.CSSProperties,
  dragOverlay: { position: 'absolute' as const, inset: 0, background: 'rgba(79,142,247,0.08)', border: '2px dashed var(--color-accent)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, pointerEvents: 'none' as const } as React.CSSProperties,
  dragContent: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '8px', color: 'var(--color-accent)', fontSize: '14px', fontWeight: 600 } as React.CSSProperties,
  empty: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' } as React.CSSProperties,
  emptyContent: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '8px' } as React.CSSProperties,
  emptyIcon: { fontSize: '32px', color: 'var(--color-text-muted)', fontWeight: 700, opacity: 0.3 } as React.CSSProperties,
  emptyText: { color: 'var(--color-text-muted)', fontSize: '14px' } as React.CSSProperties,
  emptyHint: { color: 'var(--color-text-muted)', fontSize: '11px', opacity: 0.7 } as React.CSSProperties,
  header: { height: '48px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: '10px', flexShrink: 0 } as React.CSSProperties,
  headerAvatar: { width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 700 } as React.CSSProperties,
  headerName: { fontSize: '15px', fontWeight: 600 } as React.CSSProperties,
  messages: { flex: 1, overflowY: 'auto' as const, padding: '16px', display: 'flex', flexDirection: 'column' as const, gap: '4px' } as React.CSSProperties,
  emptyChannel: { fontSize: '13px', color: 'var(--color-text-muted)', padding: '8px 0' } as React.CSSProperties,
  msgGroup: { position: 'relative' as const, display: 'flex', gap: '12px', padding: '2px 0', marginBottom: '8px' } as React.CSSProperties,
  avatar: { width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, flexShrink: 0, alignSelf: 'flex-start' as const, marginTop: '2px' } as React.CSSProperties,
  msgBody: { flex: 1, minWidth: 0 } as React.CSSProperties,
  msgHeader: { display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '2px' } as React.CSSProperties,
  author: { fontSize: '14px', fontWeight: 600 } as React.CSSProperties,
  time: { fontSize: '11px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' } as React.CSSProperties,
  content: { fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.5, wordBreak: 'break-word' as const } as React.CSSProperties,
  inputArea: { padding: '10px 16px 14px', flexShrink: 0 } as React.CSSProperties,
  inputWrap: { display: 'flex', alignItems: 'center', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: '10px', gap: '8px', paddingRight: '8px' } as React.CSSProperties,
  input: { flex: 1, background: 'transparent', border: 'none', color: 'var(--color-text-primary)', padding: '10px 12px', outline: 'none', fontSize: '13px', fontFamily: 'inherit' } as React.CSSProperties,
  iconBtn: { width: '30px', height: '30px', borderRadius: '6px', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } as React.CSSProperties,
  sendBtn: { width: '30px', height: '30px', borderRadius: '6px', background: 'var(--color-accent)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } as React.CSSProperties,
} as const;
