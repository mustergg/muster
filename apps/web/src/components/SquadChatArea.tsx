/**
 * SquadChatArea — R13
 *
 * Chat view for a squad's text channel. Also shows voice placeholder.
 * Includes squad settings (invite, kick, leave, delete).
 */

import React, { useState, useEffect, useRef } from 'react';
import { useSquadStore } from '../stores/squadStore.js';
import { useNetworkStore } from '../stores/networkStore.js';

interface Props {
  squadId: string;
  mode: 'text' | 'voice';
}

export default function SquadChatArea({ squadId, mode }: Props): React.JSX.Element {
  const { messages, members, sendMessage, openSquad, inviteMember, kickMember, leaveSquad, deleteSquad, lastMessage, clearMessage, loadMembers } = useSquadStore();
  const { publicKey: myKey } = useNetworkStore();
  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [inviteUsername, setInviteUsername] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const squadMessages = messages[squadId] || [];
  const squadMembers = members[squadId] || [];

  // Find squad info
  const allSquads = useSquadStore((s) => s.squads);
  let squad: any = null;
  for (const list of Object.values(allSquads)) {
    const found = list.find((s) => s.id === squadId);
    if (found) { squad = found; break; }
  }
  const isOwner = squad?.ownerPublicKey === myKey;

  useEffect(() => {
    if (squadId) openSquad(squadId);
  }, [squadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [squadMessages.length]);

  useEffect(() => {
    if (lastMessage) {
      const t = setTimeout(clearMessage, 4000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [lastMessage]);

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage(squadId, input.trim());
    setInput('');
  };

  const handleInvite = () => {
    if (inviteUsername.trim()) {
      inviteMember(squadId, inviteUsername.trim());
      setInviteUsername('');
    }
  };

  if (mode === 'voice') {
    return (
      <div style={s.container}>
        <div style={s.header}>
          <span style={s.headerIcon}>{'\u{1F3A4}'}</span>
          <span style={s.headerTitle}>{squad?.name || 'Squad'} — Voice</span>
        </div>
        <div style={s.voicePlaceholder}>
          <div style={s.voiceIcon}>{'\u{1F50A}'}</div>
          <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 600 }}>Voice Channel</h3>
          <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '13px' }}>Voice chat coming in R18 (WebRTC).</p>
          <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)', fontSize: '12px' }}>The infrastructure is ready — just needs the audio engine.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={s.container}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.headerIcon}>#</span>
        <span style={s.headerTitle}>{squad?.name || 'Squad'}</span>
        <span style={s.memberCount}>{squadMembers.length} members</span>
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
                <span style={s.memberName}>{m.username}</span>
                {m.role === 'owner' && <span style={s.ownerBadge}>owner</span>}
                {isOwner && m.publicKey !== myKey && (
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
        {squadMessages.map((m) => (
          <div key={m.messageId} style={s.msg}>
            <span style={s.msgAuthor}>{m.senderUsername}</span>
            <span style={s.msgContent}>{m.content}</span>
            <span style={s.msgTime}>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={s.inputBar}>
        <input
          type="text" value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder={`Message ${squad?.name || 'squad'}...`}
          style={s.chatInput}
        />
        <button onClick={handleSend} disabled={!input.trim()} style={{ ...s.sendBtn, opacity: input.trim() ? 1 : 0.5 }}>Send</button>
      </div>
    </div>
  );
}

const s = {
  container: { display: 'flex', flexDirection: 'column' as const, height: '100%', background: 'var(--color-bg-primary)' } as React.CSSProperties,
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
  msg: { display: 'flex', gap: '6px', alignItems: 'baseline', padding: '2px 0' } as React.CSSProperties,
  msgAuthor: { fontSize: '13px', fontWeight: 600, flexShrink: 0 } as React.CSSProperties,
  msgContent: { fontSize: '13px', color: 'var(--color-text-secondary)', wordBreak: 'break-word' as const } as React.CSSProperties,
  msgTime: { fontSize: '10px', color: 'var(--color-text-muted)', marginLeft: 'auto', flexShrink: 0 } as React.CSSProperties,
  inputBar: { display: 'flex', gap: '6px', padding: '10px 16px', borderTop: '1px solid var(--color-border)', flexShrink: 0 } as React.CSSProperties,
  chatInput: { flex: 1, padding: '8px 12px', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', fontSize: '13px', outline: 'none', fontFamily: 'inherit' } as React.CSSProperties,
  sendBtn: { padding: '8px 16px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: '12px', fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  voicePlaceholder: { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'var(--color-text-secondary)' } as React.CSSProperties,
  voiceIcon: { fontSize: '48px', opacity: 0.4 } as React.CSSProperties,
} as const;
