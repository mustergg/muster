import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore, type ChatMessage } from '../stores/chatStore.js';
import type { ActiveLocation } from '../pages/MainLayout.js';

interface Props {
  active: ActiveLocation | null;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MessageRow({ msg }: { msg: ChatMessage }): React.JSX.Element {
  const initials = (msg.senderUsername || '??').slice(0, 2).toUpperCase();
  const hue = parseInt((msg.senderPublicKey || '0000').slice(0, 4), 16) % 360;

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

export default function ChatArea({ active }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { messages, subscribe, unsubscribe, sendMessage } = useChatStore();
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
      subscribe([active.channelId]);
      return () => unsubscribe([active.channelId]);
  }, [active?.communityId, active?.channelId]);

  // Auto-scroll to bottom on new messages
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
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerIcon}>#</span>
        <span style={styles.headerName}>{active.channelName}</span>
      </div>

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
          <input
            style={styles.input}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('channel.textPlaceholder', { name: active.channelName })}
          />
          <button
            onClick={handleSend}
            disabled={!draft.trim()}
            style={styles.sendBtn}
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  } as React.CSSProperties,
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as React.CSSProperties,
  header: {
    height: '48px',
    borderBottom: '1px solid var(--color-border)',
    display: 'flex',
    alignItems: 'center',
    padding: '0 16px',
    gap: '8px',
    flexShrink: 0,
  } as React.CSSProperties,
  headerIcon: {
    fontFamily: 'var(--font-mono)',
    fontSize: '16px',
    color: 'var(--color-text-muted)',
  } as React.CSSProperties,
  headerName: {
    fontSize: '15px',
    fontWeight: 600,
  } as React.CSSProperties,
  messages: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  } as React.CSSProperties,
  emptyChannel: {
    fontSize: '13px',
    color: 'var(--color-text-muted)',
    padding: '8px 0',
  } as React.CSSProperties,
  msgGroup: {
    display: 'flex',
    gap: '12px',
    padding: '2px 0',
    marginBottom: '8px',
  } as React.CSSProperties,
  avatar: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 700,
    flexShrink: 0,
    alignSelf: 'flex-start' as const,
    marginTop: '2px',
  } as React.CSSProperties,
  msgBody: {
    flex: 1,
    minWidth: 0,
  } as React.CSSProperties,
  msgHeader: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    marginBottom: '2px',
  } as React.CSSProperties,
  author: {
    fontSize: '14px',
    fontWeight: 600,
  } as React.CSSProperties,
  time: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    fontFamily: 'var(--font-mono)',
  } as React.CSSProperties,
  content: {
    fontSize: '13px',
    color: 'var(--color-text-secondary)',
    lineHeight: 1.5,
    wordBreak: 'break-word' as const,
  } as React.CSSProperties,
  inputArea: {
    padding: '10px 16px 14px',
    flexShrink: 0,
  } as React.CSSProperties,
  inputWrap: {
    display: 'flex',
    alignItems: 'center',
    background: 'var(--color-bg-input)',
    border: '1px solid var(--color-border)',
    borderRadius: '10px',
    gap: '8px',
    paddingRight: '8px',
  } as React.CSSProperties,
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    color: 'var(--color-text-primary)',
    padding: '10px 12px',
    outline: 'none',
    fontSize: '13px',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  sendBtn: {
    width: '30px',
    height: '30px',
    borderRadius: '6px',
    background: 'var(--color-accent)',
    border: 'none',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    opacity: 1,
    transition: 'opacity 0.15s',
  } as React.CSSProperties,
} as const;

