/**
 * DMChatArea — chat area for direct messages.
 * Similar to ChatArea but uses dmStore instead of chatStore.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useDMStore, type DMMessage } from '../stores/dmStore.js';
import { useNetworkStore } from '../stores/networkStore.js';

interface Props {
  /** Public key of the conversation partner. */
  partnerPublicKey: string | null;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function DMMessageRow({ msg }: { msg: DMMessage }): React.JSX.Element {
  const hue = parseInt((msg.senderPublicKey || '0000').slice(0, 4), 16) % 360;
  const initials = (msg.senderUsername || '??').slice(0, 2).toUpperCase();

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
        <p style={styles.content}>{msg.content}</p>
      </div>
    </div>
  );
}

export default function DMChatArea({ partnerPublicKey }: Props): React.JSX.Element {
  const { messages, sendDM, openConversation, conversations } = useDMStore();
  const { publicKey: myKey } = useNetworkStore();
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

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

  const handleSend = (): void => {
    if (!partnerPublicKey || !draft.trim()) return;
    sendDM(partnerPublicKey, draft.trim());
    setDraft('');
  };

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

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={{ ...styles.headerAvatar, background: `hsl(${partnerHue},40%,20%)`, color: `hsl(${partnerHue},70%,65%)` }}>
          {(partnerName || '??').slice(0, 2).toUpperCase()}
        </div>
        <span style={styles.headerName}>{partnerName}</span>
      </div>

      {/* Messages */}
      <div style={styles.messages}>
        {dmMessages.length === 0 && (
          <div style={styles.emptyChannel}>
            This is the beginning of your conversation with {partnerName}.
          </div>
        )}
        {dmMessages.map((msg) => (
          <DMMessageRow key={msg.messageId} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={styles.inputArea}>
        <div style={styles.inputWrap}>
          <input
            style={styles.input}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${partnerName}`}
          />
          <button onClick={handleSend} disabled={!draft.trim()} style={styles.sendBtn}>
            &#x2191;
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' } as React.CSSProperties,
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
  msgGroup: { display: 'flex', gap: '12px', padding: '2px 0', marginBottom: '8px' } as React.CSSProperties,
  avatar: { width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, flexShrink: 0, alignSelf: 'flex-start' as const, marginTop: '2px' } as React.CSSProperties,
  msgBody: { flex: 1, minWidth: 0 } as React.CSSProperties,
  msgHeader: { display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '2px' } as React.CSSProperties,
  author: { fontSize: '14px', fontWeight: 600 } as React.CSSProperties,
  time: { fontSize: '11px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' } as React.CSSProperties,
  content: { fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.5, wordBreak: 'break-word' as const } as React.CSSProperties,
  inputArea: { padding: '10px 16px 14px', flexShrink: 0 } as React.CSSProperties,
  inputWrap: { display: 'flex', alignItems: 'center', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: '10px', gap: '8px', paddingRight: '8px' } as React.CSSProperties,
  input: { flex: 1, background: 'transparent', border: 'none', color: 'var(--color-text-primary)', padding: '10px 12px', outline: 'none', fontSize: '13px', fontFamily: 'inherit' } as React.CSSProperties,
  sendBtn: { width: '30px', height: '30px', borderRadius: '6px', background: 'var(--color-accent)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } as React.CSSProperties,
} as const;
