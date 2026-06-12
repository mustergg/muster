/**
 * SquadChatArea — R13
 *
 * Chat view for a squad's text channel. Also shows voice placeholder.
 * Includes squad settings (invite, kick, leave, delete).
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSquadStore, SQUAD_BLOB_PREFIX, squadRoomKey, type SquadRoom } from '../stores/squadStore.js';
import { useNetworkStore } from '../stores/networkStore.js';
import { useCommunityStore } from '../stores/communityStore.js';
import { useComposerStore, appendMention, handleMentionBackspace } from '../stores/composerStore.js';
import { parseReply, packReply, replyPreview, mentionsUser, flashMessage, isFirstMentionView } from '../lib/messageFx.js';
import { useTypeToFocus } from '../lib/useTypeToFocus.js';
import { fetchAndDecryptBlob } from '../lib/blobUpload.js';
import EmojiPicker from './EmojiPicker.js';
import VoiceRecorder from './VoiceRecorder.js';
import ComposerBar from './ComposerBar.js';
import { useIsMobile } from '../lib/useResponsive.js';
import VoicePanel from './VoicePanel.js';
import { ReceiptToggle, SeenIndicator, MarkSeenButton } from './ReadReceiptUI.js';
import { useReadReceiptStore } from '../stores/readReceiptStore.js';

interface Props {
  squadId: string;
  mode: 'text' | 'voice';
}

const MAX_SQUAD_FILE = 100 * 1024 * 1024;
const SQUAD_EDIT_WINDOW_MS = 15 * 60 * 1000;

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

interface BlobDesc { root: string; size: number; mime: string; name: string; pieceCount: number; key: string; }

function parseBlobContent(content: string): BlobDesc | null {
  if (!content.startsWith(SQUAD_BLOB_PREFIX)) return null;
  try { return JSON.parse(content.slice(SQUAD_BLOB_PREFIX.length)); } catch { return null; }
}

function SquadAttachment({ desc }: { desc: BlobDesc }): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'failed'>('idle');
  const isImage = desc.mime.startsWith('image/');
  const isAudio = desc.mime.startsWith('audio/');

  const fetchIt = useCallback(async () => {
    if (url || status === 'loading') return;
    setStatus('loading');
    try {
      const network = useNetworkStore.getState();
      const bytes = await fetchAndDecryptBlob(
        { send: (m) => network.transport!.send(m), isConnected: !!network.transport?.isConnected, onMessage: network.onMessage },
        { rootHex: desc.root, size: desc.size, mime: desc.mime, pieceCount: desc.pieceCount, keyHex: desc.key },
      );
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      setUrl(URL.createObjectURL(new Blob([ab], { type: desc.mime })));
      setStatus('idle');
    } catch (err) { console.warn('[squad] attachment fetch failed:', err); setStatus('failed'); }
  }, [url, status, desc]);

  useEffect(() => { if (isImage || isAudio) void fetchIt(); }, [isImage, isAudio]);

  const download = () => {
    if (!url) { void fetchIt(); return; }
    const a = document.createElement('a'); a.href = url; a.download = desc.name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  if (isImage) {
    if (status === 'loading') return <div style={fs.ph}>Loading image…</div>;
    if (status === 'failed') return <div style={fs.ph}>Failed to load image</div>;
    if (url) return <div style={fs.wrap}><img src={url} alt={desc.name} style={fs.img} onClick={download} /><span style={fs.lbl}>{desc.name} ({formatSize(desc.size)})</span></div>;
    return <></>;
  }
  if (isAudio) {
    if (status === 'loading') return <div style={fs.ph}>{'\u{1F3A4}'} Loading voice note…</div>;
    if (status === 'failed') return <div style={fs.ph}>Failed to load voice note</div>;
    if (url) return <div style={fs.wrap}><audio src={url} controls style={{ maxWidth: '320px' }} /><span style={fs.lbl}>{'\u{1F3A4}'} {formatSize(desc.size)}</span></div>;
    return <></>;
  }
  return (
    <div style={fs.card}>
      <span style={{ fontSize: '18px' }}>&#x1F4CE;</span>
      <div style={fs.meta}><span style={fs.name}>{desc.name}</span><span style={fs.size}>{formatSize(desc.size)}{status === 'failed' ? ' · failed' : ''}</span></div>
      <button onClick={download} style={fs.dl}>{status === 'loading' ? '…' : '⬇'}</button>
    </div>
  );
}

const fs = {
  ph: { padding: '10px', background: 'var(--color-bg-hover)', borderRadius: '8px', fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px' } as React.CSSProperties,
  wrap: { marginTop: '4px', display: 'flex', flexDirection: 'column' as const, gap: '4px' } as React.CSSProperties,
  img: { maxWidth: '360px', maxHeight: '280px', borderRadius: '8px', cursor: 'pointer', objectFit: 'contain' as const, border: '1px solid var(--color-border)' } as React.CSSProperties,
  lbl: { fontSize: '10px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' } as React.CSSProperties,
  card: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'var(--color-bg-hover)', borderRadius: '8px', marginTop: '4px', maxWidth: '320px' } as React.CSSProperties,
  meta: { flex: 1, display: 'flex', flexDirection: 'column' as const, minWidth: 0 } as React.CSSProperties,
  name: { fontSize: '13px', color: 'var(--color-accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } as React.CSSProperties,
  size: { fontSize: '10px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' } as React.CSSProperties,
  dl: { width: '28px', height: '28px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '14px', flexShrink: 0 } as React.CSSProperties,
} as const;

/** The full squad chat UI for one room ('text' or 'voice'). */
function SquadBody({ squadId, room }: { squadId: string; room: SquadRoom }): React.JSX.Element {
  const { messages, members, sendMessage, sendSquadFile, openSquad, loadRoom, inviteMember, kickMember, leaveSquad, deleteSquad, detachSquad, deleteSquadMessage, editSquadMessage, lastMessage, clearMessage, loadMembers } = useSquadStore();
  const { publicKey: myKey, username: myUsername } = useNetworkStore();
  const myCommunityRoles = useCommunityStore((st) => st.myRoles);
  const msgKey = squadRoomKey(squadId, room);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState<{ messageId: string; preview: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [inviteUsername, setInviteUsername] = useState('');
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  useTypeToFocus(textInputRef);
  const isMobile = useIsMobile();

  const uploadFile = useCallback(async (file: File) => {
    if (file.size > MAX_SQUAD_FILE) { alert(`File too large. Max ${formatSize(MAX_SQUAD_FILE)}.`); return; }
    setUploading(true);
    try { await sendSquadFile(squadId, file, room); }
    catch (err) { console.error('[squad] upload failed:', err); alert('Failed to send file.'); }
    finally { setUploading(false); }
  }, [squadId, room, sendSquadFile]);

  const squadMessages = messages[msgKey] || [];
  const squadMembers = members[squadId] || [];

  // Find squad info
  const allSquads = useSquadStore((s) => s.squads);
  let squad: any = null;
  for (const list of Object.values(allSquads)) {
    const found = list.find((s) => s.id === squadId);
    if (found) { squad = found; break; }
  }
  const isOwner = squad?.ownerPublicKey === myKey;
  const cid: string = squad?.communityId || '';
  const isCommunitySquad = !!cid && !cid.startsWith('personal:');
  const myCommRole = isCommunitySquad ? myCommunityRoles[cid] : undefined;
  const canDetach = isCommunitySquad && (isOwner || myCommRole === 'owner' || myCommRole === 'admin');
  const myMember = (members[squadId] || []).find((m) => m.publicKey === myKey);
  const canModerate = isOwner || myMember?.role === 'admin' || myMember?.role === 'moderator';

  useEffect(() => {
    if (!squadId) return;
    // Always open the squad (subscribe + members + group key + text history).
    openSquad(squadId);
    // Voice room needs its own dedicated text-chat history.
    if (room === 'voice') loadRoom(squadId, 'voice');
  }, [squadId, room]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [squadMessages.length]);

  // Auto-send read receipts for others' squad messages when enabled.
  useEffect(() => {
    const ack = useReadReceiptStore.getState().ack;
    for (const m of squadMessages) {
      if (!m.isOwn) ack('squad', msgKey, m.messageId, m.timestamp);
    }
  }, [msgKey, squadMessages.length]);

  useEffect(() => {
    if (lastMessage) {
      const t = setTimeout(clearMessage, 4000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [lastMessage]);

  // Let member-list clicks drop an @mention into this composer.
  const setComposerHandler = useComposerStore((s) => s.setHandler);
  useEffect(() => {
    setComposerHandler((u) => setInput((d) => appendMention(d, u)));
    return () => setComposerHandler(null);
  }, [msgKey]);

  const handleSend = () => {
    if (!input.trim()) return;
    const body = input.trim();
    sendMessage(squadId, replyTo ? packReply(replyTo.messageId, body) : body, room);
    setInput('');
    setReplyTo(null);
  };

  const resolveReply = (id: string): { username: string; preview: string } | null => {
    const orig = (messages[msgKey] || []).find((m) => m.messageId === id);
    if (!orig) return null;
    return { username: orig.senderUsername, preview: replyPreview(orig.content, 99) };
  };

  // Flash messages that @mention me the first time I see them.
  useEffect(() => {
    for (const m of (messages[msgKey] || [])) {
      if (!m.isOwn && mentionsUser(parseReply(m.content).text, myUsername) && isFirstMentionView(myKey, m.messageId)) {
        setTimeout(() => flashMessage(m.messageId), 150);
      }
    }
  }, [msgKey, (messages[msgKey] || []).length]);

  const clearComposer = (): void => { setInput(''); setReplyTo(null); textInputRef.current?.focus(); };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (handleMentionBackspace(e, input, setInput)) return;
    if (e.key === 'Escape') { e.preventDefault(); clearComposer(); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleInvite = () => {
    if (inviteUsername.trim()) {
      inviteMember(squadId, inviteUsername.trim());
      setInviteUsername('');
    }
  };

  return (
    <div style={s.container}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.headerIcon}>#</span>
        <span style={s.headerTitle}>{squad?.name || 'Squad'}{room === 'voice' ? ' · voice' : ''}</span>
        <span style={s.memberCount}>{squadMembers.length} members</span>
        <ReceiptToggle context="squad" contextId={msgKey} />
        <button onClick={() => { setShowSettings(!showSettings); if (!showSettings) loadMembers(squadId); }} style={s.settingsBtn} title="Squad settings">
          {'\u2699'}
        </button>
      </div>

      {lastMessage && <div style={s.toast}>{lastMessage}</div>}

      {/* Settings panel (toggle) */}
      {showSettings && (
        <div style={s.settingsPanel}>
          <div style={s.settingsSection}>
            <div style={s.settingsLabel}>Members</div>
            {squadMembers.map((m) => (
              <div key={m.publicKey} style={s.memberRow}>
                <span style={s.memberName}>{m.username}{m.ghost ? ' · staff' : ''}</span>
                {(m.role === 'owner' || m.role === 'admin' || m.role === 'moderator') && (
                  <span style={s.ownerBadge}>{m.role === 'moderator' ? 'mod' : m.role}</span>
                )}
                {isOwner && m.publicKey !== myKey && !m.ghost && (
                  <button onClick={() => kickMember(squadId, m.publicKey)} style={s.kickBtn} title="Kick">&#x2715;</button>
                )}
              </div>
            ))}
          </div>

          {isOwner && (
            <div style={s.settingsSection}>
              <div style={s.settingsLabel}>Invite member</div>
              <div style={s.inviteRow}>
                <input
                  type="text" value={inviteUsername}
                  onChange={(e) => setInviteUsername(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                  placeholder="Username..." style={s.input}
                />
                <button onClick={handleInvite} disabled={!inviteUsername.trim()} style={{ ...s.inviteBtn, opacity: inviteUsername.trim() ? 1 : 0.5 }}>Add</button>
              </div>
            </div>
          )}

          <div style={s.settingsSection}>
            {canDetach && (
              <button
                onClick={() => { if (confirm('Detach this squad from the community? It becomes a personal squad and community staff lose access.')) detachSquad(squadId); }}
                style={s.dangerBtn}
              >
                Detach from community
              </button>
            )}
            {isOwner ? (
              <button onClick={() => { if (confirm('Delete this squad? This cannot be undone.')) deleteSquad(squadId); }} style={s.dangerBtn}>Delete squad</button>
            ) : (
              <button onClick={() => { if (confirm('Leave this squad?')) leaveSquad(squadId); }} style={s.dangerBtn}>Leave squad</button>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div style={s.messageList}>
        {squadMessages.length === 0 && (
          <div style={s.empty}>No messages yet. Say hello!</div>
        )}
        {squadMessages.map((m) => {
          const blob = parseBlobContent(m.content);
          const within = (Date.now() - m.timestamp) <= SQUAD_EDIT_WINDOW_MS;
          const canEdit = m.isOwn && within && !blob;
          const isEditing = editingId === m.messageId;
          const { replyTo: rTo, text } = parseReply(m.content || '');
          const repliedTo = rTo ? resolveReply(rTo) : null;
          const mentioned = mentionsUser(text, myUsername);
          const saveEdit = () => {
            const v = editDraft.trim();
            setEditingId(null);
            if (v && v !== text) editSquadMessage(squadId, m.messageId, rTo ? packReply(rTo, v) : v, room);
          };
          return (
            <div key={m.messageId} id={`msg-${m.messageId}`} style={{ ...s.msgRow, justifyContent: m.isOwn ? 'flex-end' : 'flex-start' }}>
              <div style={s.msgBubble}>
                {repliedTo && (
                  <button style={s.replyChip} onClick={() => rTo && flashMessage(rTo)} title="Jump to message">
                    {'↪'} {repliedTo.username}: {repliedTo.preview}
                  </button>
                )}
                <div style={s.msg}>
                  <span style={s.msgAuthor}>{m.senderUsername}</span>
                  {isEditing ? (
                    <span style={s.editRow}>
                      <input
                        autoFocus
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } else if (e.key === 'Escape') setEditingId(null); }}
                        style={s.editInput}
                      />
                      <button onClick={saveEdit} style={s.editSave}>Save</button>
                      <button onClick={() => setEditingId(null)} style={s.editCancel}>Cancel</button>
                    </span>
                  ) : (
                    blob ? <SquadAttachment desc={blob} /> : <span style={{ ...s.msgContent, ...(mentioned ? s.mentioned : {}) }}>{text}{m.edited ? <span style={s.editedTag}> (edited)</span> : ''}</span>
                  )}
                  <span style={s.msgTime}>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {m.isOwn
                    ? <SeenIndicator context="squad" contextId={msgKey} messageId={m.messageId} />
                    : <MarkSeenButton context="squad" contextId={msgKey} messageId={m.messageId} />}
                  {!isEditing && (
                    <button onClick={() => setReplyTo({ messageId: m.messageId, preview: replyPreview(m.content, 80) })} style={s.delMsgBtn} title="Reply">{'↩️'}</button>
                  )}
                  {!isEditing && canEdit && (
                    <button onClick={() => { setEditDraft(text); setEditingId(m.messageId); }} style={s.delMsgBtn} title="Edit message">{'✏️'}</button>
                  )}
                  {!isEditing && (m.isOwn || canModerate) && (
                    <button onClick={() => { if (confirm('Delete this message?')) deleteSquadMessage(squadId, m.messageId, room); }} style={s.delMsgBtn} title="Delete message">{'\u{1F5D1}'}</button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {replyTo && (
        <div style={s.replyBar}>
          <span style={s.replyBarText}>{'↩️'} Replying to: {replyTo.preview}</span>
          <button onClick={() => setReplyTo(null)} style={s.replyBarClose} title="Cancel reply">{'✕'}</button>
        </div>
      )}

      {/* Input */}
      <div style={s.inputArea}>
        <ComposerBar
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          onPickFile={() => fileInputRef.current?.click()}
          onSendVoice={(f) => void uploadFile(f)}
          voiceDisabled={uploading}
          showClear={!!(input || replyTo)}
          onClear={clearComposer}
          placeholder={`Message ${squad?.name || 'squad'}...`}
          disabled={uploading}
          inputRef={textInputRef}
          isMobile={isMobile}
          sendDisabled={!input.trim()}
        />
        <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ''; }} />
      </div>
    </div>
  );
}

/**
 * SquadChatArea — picks the room layout.
 *  - text:  the squad's main text chat.
 *  - voice: the voice panel stacked on top of the voice channel's dedicated
 *           text chat (mirrors community voice channels).
 */
export default function SquadChatArea({ squadId, mode }: Props): React.JSX.Element {
  const allSquads = useSquadStore((st) => st.squads);

  if (mode === 'voice') {
    let squad: any = null;
    for (const list of Object.values(allSquads)) {
      const found = list.find((sq) => sq.id === squadId);
      if (found) { squad = found; break; }
    }
    const voiceChannelId = squad?.voiceChannelId || `sq-voice-${squadId}`;
    return (
      <div style={vstyle.stack}>
        <div style={vstyle.top}>
          <VoicePanel channelId={voiceChannelId} channelName={`${squad?.name || 'Squad'} Voice`} />
        </div>
        <div style={vstyle.bottom}>
          <SquadBody squadId={squadId} room="voice" />
        </div>
      </div>
    );
  }

  return <SquadBody squadId={squadId} room="text" />;
}

const vstyle = {
  stack: { flex: 1, display: 'flex', flexDirection: 'column' as const, minHeight: 0, overflow: 'hidden' } as React.CSSProperties,
  top: { flex: '0 0 45%', minHeight: 0, borderBottom: '1px solid var(--color-border)', overflow: 'hidden' } as React.CSSProperties,
  bottom: { flex: '1 1 55%', minHeight: 0, display: 'flex', overflow: 'hidden' } as React.CSSProperties,
} as const;

const s = {
  container: { flex: 1, minWidth: 0, width: '100%', display: 'flex', flexDirection: 'column' as const, height: '100%', background: 'var(--color-bg-primary)' } as React.CSSProperties,
  header: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 } as React.CSSProperties,
  headerIcon: { fontSize: '16px', color: 'var(--color-text-muted)' } as React.CSSProperties,
  headerTitle: { fontSize: '15px', fontWeight: 600, flex: 1 } as React.CSSProperties,
  memberCount: { fontSize: '11px', color: 'var(--color-text-muted)' } as React.CSSProperties,
  settingsBtn: { width: '28px', height: '28px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' } as React.CSSProperties,
  toast: { padding: '6px 16px', fontSize: '12px', color: 'var(--color-accent)', background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' } as React.CSSProperties,
  settingsPanel: { borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', padding: '12px 16px', display: 'flex', flexDirection: 'column' as const, gap: '12px', maxHeight: '300px', overflowY: 'auto' as const, flexShrink: 0 } as React.CSSProperties,
  settingsSection: { display: 'flex', flexDirection: 'column' as const, gap: '6px' } as React.CSSProperties,
  settingsLabel: { fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' } as React.CSSProperties,
  memberRow: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0' } as React.CSSProperties,
  memberName: { fontSize: '13px', flex: 1 } as React.CSSProperties,
  ownerBadge: { fontSize: '10px', color: 'var(--color-accent)', background: 'var(--color-bg-hover)', padding: '1px 6px', borderRadius: '4px' } as React.CSSProperties,
  kickBtn: { width: '20px', height: '20px', borderRadius: '4px', border: 'none', background: 'transparent', color: '#E24B4A', cursor: 'pointer', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' } as React.CSSProperties,
  inviteRow: { display: 'flex', gap: '6px' } as React.CSSProperties,
  input: { flex: 1, padding: '6px 10px', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', fontSize: '12px', outline: 'none', fontFamily: 'inherit' } as React.CSSProperties,
  inviteBtn: { padding: '6px 12px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: '11px', fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  dangerBtn: { padding: '6px 12px', borderRadius: 'var(--radius-md)', border: '1px solid #E24B4A', background: 'transparent', color: '#E24B4A', fontSize: '12px', cursor: 'pointer', alignSelf: 'flex-start' as const } as React.CSSProperties,
  messageList: { flex: 1, overflowY: 'auto' as const, padding: '12px 16px', display: 'flex', flexDirection: 'column' as const, gap: '4px' } as React.CSSProperties,
  empty: { textAlign: 'center' as const, color: 'var(--color-text-muted)', fontSize: '13px', padding: '48px 16px' } as React.CSSProperties,
  msgRow: { display: 'flex', padding: '1px 0' } as React.CSSProperties,
  msgBubble: { maxWidth: '85%', minWidth: 0 } as React.CSSProperties,
  msg: { display: 'flex', gap: '6px', alignItems: 'baseline', padding: '2px 0' } as React.CSSProperties,
  mentioned: { fontWeight: 700, color: 'var(--color-text-primary)' } as React.CSSProperties,
  replyChip: { display: 'inline-flex', alignItems: 'center', gap: '4px', maxWidth: '100%', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', fontSize: '10px', cursor: 'pointer', padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, textAlign: 'left' as const } as React.CSSProperties,
  replyBar: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 16px', background: 'var(--color-bg-secondary)', borderTop: '1px solid var(--color-border)' } as React.CSSProperties,
  replyBarText: { flex: 1, fontSize: '12px', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } as React.CSSProperties,
  replyBarClose: { background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '12px', flexShrink: 0 } as React.CSSProperties,
  clearBtn: { width: '24px', height: '24px', borderRadius: '50%', border: 'none', background: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '11px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' } as React.CSSProperties,
  msgAuthor: { fontSize: '13px', fontWeight: 600, flexShrink: 0 } as React.CSSProperties,
  msgContent: { fontSize: '13px', color: 'var(--color-text-secondary)', wordBreak: 'break-word' as const } as React.CSSProperties,
  msgTime: { fontSize: '10px', color: 'var(--color-text-muted)', marginLeft: 'auto', flexShrink: 0 } as React.CSSProperties,
  delMsgBtn: { background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '11px', padding: '0 2px', flexShrink: 0, opacity: 0.6 } as React.CSSProperties,
  editRow: { display: 'inline-flex', gap: '6px', alignItems: 'center', flex: 1 } as React.CSSProperties,
  editInput: { flex: 1, padding: '4px 8px', background: 'var(--color-bg-input)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', fontSize: '13px', outline: 'none', fontFamily: 'inherit' } as React.CSSProperties,
  editSave: { padding: '3px 8px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: '10px', fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  editCancel: { padding: '3px 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: '10px', cursor: 'pointer' } as React.CSSProperties,
  editedTag: { fontSize: '10px', color: 'var(--color-text-muted)' } as React.CSSProperties,
  inputBar: { display: 'flex', gap: '6px', padding: '10px 16px', borderTop: '1px solid var(--color-border)', flexShrink: 0, alignItems: 'flex-end' } as React.CSSProperties,
  inputArea: { padding: '10px 16px', borderTop: '1px solid var(--color-border)', flexShrink: 0 } as React.CSSProperties,
  iconBtn: { width: '30px', height: '30px', borderRadius: '6px', background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } as React.CSSProperties,
  chatInput: { flex: 1, padding: '8px 12px', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', fontSize: '13px', outline: 'none', fontFamily: 'inherit' } as React.CSSProperties,
  sendBtn: { padding: '8px 16px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: '12px', fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  voicePlaceholder: { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'var(--color-text-secondary)' } as React.CSSProperties,
  voiceIcon: { fontSize: '48px', opacity: 0.4 } as React.CSSProperties,
} as const;
