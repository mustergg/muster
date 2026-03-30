/**
 * DMConversationList — R5b update
 * Changes: Added context menu (right-click / long-press) to delete conversations.
 */

import React, { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore.js';
import { useNetworkStore } from '../stores/networkStore.js';
import { useDMStore, type DMConversation } from '../stores/dmStore.js';
import ContextMenu from './ContextMenu.js';

interface Props {
  activeConversation: string | null;
  onSelectConversation: (publicKey: string) => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function DMConversationList({ activeConversation, onSelectConversation }: Props): React.JSX.Element {
  const { username, logout } = useAuthStore();
  const { status, disconnect } = useNetworkStore();
  const { conversations, loadConversations, clearConversation } = useDMStore();

  useEffect(() => {
    if (status === 'connected') loadConversations();
  }, [status]);

  return (
    <div style={styles.sidebar}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Direct Messages</span>
      </div>

      <div style={styles.list}>
        {conversations.length === 0 ? (
          <div style={styles.empty}>
            <p style={styles.emptyText}>No conversations yet.</p>
            <p style={styles.emptyHint}>Click DM next to a member's name to start a conversation.</p>
          </div>
        ) : (
          conversations.map((conv) => (
            <ContextMenu
              key={conv.publicKey}
              items={[
                {
                  label: 'Delete conversation',
                  icon: '\u{1F5D1}',
                  danger: true,
                  onClick: () => {
                    if (confirm(`Delete conversation with ${conv.username}? This only clears your local copy.`)) {
                      clearConversation(conv.publicKey);
                    }
                  },
                },
              ]}
            >
              <ConversationItem
                conv={conv}
                isActive={activeConversation === conv.publicKey}
                onClick={() => onSelectConversation(conv.publicKey)}
              />
            </ContextMenu>
          ))
        )}
      </div>

      <div style={styles.userBar}>
        <div style={styles.userInfo}>
          <div style={styles.userAvatar}>{(username || '??').slice(0, 2).toUpperCase()}</div>
          <div style={styles.userMeta}>
            <span style={styles.userName}>{username}</span>
            <span style={styles.userStatus}>{status === 'connected' ? 'Online' : 'Connecting...'}</span>
          </div>
        </div>
        <button onClick={() => { disconnect(); logout(); }} style={styles.logoutBtn} title="Logout">&#x23FB;</button>
      </div>
    </div>
  );
}

function ConversationItem({ conv, isActive, onClick }: { conv: DMConversation; isActive: boolean; onClick: () => void }): React.JSX.Element {
  const hue = parseInt((conv.publicKey || '0000').slice(0, 4), 16) % 360;
  return (
    <button onClick={onClick} style={{ ...styles.convItem, background: isActive ? 'var(--color-bg-hover)' : 'transparent' }}>
      <div style={{ ...styles.convAvatar, background: `hsl(${hue},40%,20%)`, color: `hsl(${hue},70%,65%)` }}>
        {(conv.username || '??').slice(0, 2).toUpperCase()}
      </div>
      <div style={styles.convMeta}>
        <div style={styles.convHeader}>
          <span style={styles.convName}>{conv.username || conv.publicKey.slice(0, 12) + '...'}</span>
          {conv.lastTimestamp > 0 && <span style={styles.convTime}>{formatTime(conv.lastTimestamp)}</span>}
        </div>
        {conv.lastMessage && (
          <span style={styles.convPreview}>{conv.lastMessage.length > 40 ? conv.lastMessage.slice(0, 40) + '...' : conv.lastMessage}</span>
        )}
      </div>
      {(conv.unreadCount || 0) > 0 && <span style={styles.unreadBadge}>{conv.unreadCount}</span>}
    </button>
  );
}

const styles = {
  sidebar: { width: 'var(--sidebar-channels-w)', background: 'var(--color-bg-secondary)', borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' as const, flexShrink: 0 } as React.CSSProperties,
  header: { padding: '12px 12px 8px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' } as React.CSSProperties,
  headerTitle: { fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)' } as React.CSSProperties,
  list: { flex: 1, overflowY: 'auto' as const, padding: '4px 0' } as React.CSSProperties,
  empty: { padding: '16px 12px', textAlign: 'center' as const } as React.CSSProperties,
  emptyText: { fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '4px' } as React.CSSProperties,
  emptyHint: { fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: 1.4 } as React.CSSProperties,
  convItem: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', border: 'none', cursor: 'pointer', transition: 'background 0.1s', textAlign: 'left' as const } as React.CSSProperties,
  convAvatar: { width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, flexShrink: 0 } as React.CSSProperties,
  convMeta: { flex: 1, minWidth: 0 } as React.CSSProperties,
  convHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } as React.CSSProperties,
  convName: { fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)' } as React.CSSProperties,
  convTime: { fontSize: '10px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' } as React.CSSProperties,
  convPreview: { fontSize: '11px', color: 'var(--color-text-muted)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } as React.CSSProperties,
  unreadBadge: { background: '#E24B4A', color: '#fff', fontSize: '10px', fontWeight: 700, minWidth: '18px', height: '18px', borderRadius: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', flexShrink: 0 } as React.CSSProperties,
  userBar: { padding: '8px 10px', borderTop: '1px solid var(--color-border)', background: 'var(--color-bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' } as React.CSSProperties,
  userInfo: { display: 'flex', alignItems: 'center', gap: '8px' } as React.CSSProperties,
  userAvatar: { width: '28px', height: '28px', borderRadius: '50%', background: 'var(--color-accent)', color: '#fff', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' } as React.CSSProperties,
  userMeta: { display: 'flex', flexDirection: 'column' as const } as React.CSSProperties,
  userName: { fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)' } as React.CSSProperties,
  userStatus: { fontSize: '10px', color: 'var(--color-text-muted)' } as React.CSSProperties,
  logoutBtn: { background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '16px', padding: '4px' } as React.CSSProperties,
} as const;
