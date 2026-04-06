/**
 * FriendsPanel — R11
 *
 * Full-page panel for managing friends.
 * Tabs: Friends | Requests | Blocked
 * Includes inline "Add Friend" input.
 *
 * NOTE: friendStore.init() is called in MainLayout (like other stores).
 * This component just refreshes data on mount.
 */

import React, { useState, useEffect } from 'react';
import { useFriendStore } from '../stores/friendStore.js';

type Tab = 'friends' | 'requests' | 'blocked';

export default function FriendsPanel(): React.JSX.Element {
  const {
    friends, incomingRequests, outgoingRequests, blockedUsers,
    lastMessage, loading,
    sendRequest, respondRequest, cancelRequest, removeFriend, unblockUser,
    clearMessage, loadFriends, loadRequests, loadBlocked,
  } = useFriendStore();

  const [tab, setTab] = useState<Tab>('friends');
  const [addUsername, setAddUsername] = useState('');

  // Refresh data when panel opens (listener already active via MainLayout)
  useEffect(() => {
    loadFriends();
    loadRequests();
    loadBlocked();
  }, []);

  // Auto-clear message after 4s
  useEffect(() => {
    if (lastMessage) {
      const t = setTimeout(clearMessage, 4000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [lastMessage]);

  const handleAddFriend = () => {
    if (addUsername.trim()) {
      sendRequest(addUsername);
      setAddUsername('');
    }
  };

  const totalRequests = incomingRequests.length + outgoingRequests.length;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>Friends</span>
      </div>

      {/* Add friend input */}
      <div style={styles.addRow}>
        <input
          type="text"
          value={addUsername}
          onChange={(e) => setAddUsername(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddFriend()}
          placeholder="Add friend by username..."
          style={styles.addInput}
        />
        <button
          onClick={handleAddFriend}
          disabled={!addUsername.trim() || loading}
          style={{ ...styles.addBtn, opacity: addUsername.trim() ? 1 : 0.5 }}
        >
          {loading ? '...' : 'Send'}
        </button>
      </div>

      {/* Status message */}
      {lastMessage && (
        <div style={styles.message}>{lastMessage}</div>
      )}

      {/* Tabs */}
      <div style={styles.tabs}>
        {(['friends', 'requests', 'blocked'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={tab === t ? styles.tabActive : styles.tab}
          >
            {t === 'friends' && `Friends (${friends.length})`}
            {t === 'requests' && `Requests${totalRequests ? ` (${totalRequests})` : ''}`}
            {t === 'blocked' && `Blocked${blockedUsers.length ? ` (${blockedUsers.length})` : ''}`}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={styles.content}>
        {tab === 'friends' && (
          friends.length === 0 ? (
            <p style={styles.empty}>No friends yet. Add someone by username above!</p>
          ) : (
            friends.map((f) => (
              <div key={f.publicKey} style={styles.row}>
                <div style={styles.avatar}>{(f.displayName || f.username || '?').slice(0, 2).toUpperCase()}</div>
                <div style={styles.info}>
                  <div style={styles.name}>
                    {f.displayName || f.username}
                    {f.displayName && <span style={styles.userTag}>@{f.username}</span>}
                  </div>
                  <div style={styles.since}>Friends since {new Date(f.since).toLocaleDateString()}</div>
                </div>
                <div style={styles.actions}>
                  <button
                    onClick={() => { if (confirm(`Remove ${f.username} from friends?`)) removeFriend(f.publicKey); }}
                    style={styles.btnDanger}
                    title="Remove friend"
                  >
                    &#x2715;
                  </button>
                </div>
              </div>
            ))
          )
        )}

        {tab === 'requests' && (
          <>
            {incomingRequests.length > 0 && (
              <>
                <div style={styles.sectionLabel}>Incoming</div>
                {incomingRequests.map((r) => (
                  <div key={r.id} style={styles.row}>
                    <div style={styles.avatar}>{r.fromUsername.slice(0, 2).toUpperCase()}</div>
                    <div style={styles.info}>
                      <div style={styles.name}>{r.fromUsername}</div>
                      <div style={styles.since}>{timeAgo(r.createdAt)}</div>
                    </div>
                    <div style={styles.actions}>
                      <button onClick={() => respondRequest(r.id, 'accept')} style={styles.btnAccept} title="Accept">&#x2713;</button>
                      <button onClick={() => respondRequest(r.id, 'decline')} style={styles.btnDecline} title="Decline">&#x2715;</button>
                      <button onClick={() => respondRequest(r.id, 'block')} style={styles.btnBlock} title="Block">&#x26D4;</button>
                    </div>
                  </div>
                ))}
              </>
            )}

            {outgoingRequests.length > 0 && (
              <>
                <div style={styles.sectionLabel}>Outgoing (pending)</div>
                {outgoingRequests.map((r) => (
                  <div key={r.id} style={styles.row}>
                    <div style={styles.avatar}>{r.toUsername.slice(0, 2).toUpperCase()}</div>
                    <div style={styles.info}>
                      <div style={styles.name}>{r.toUsername}</div>
                      <div style={styles.since}>Sent {timeAgo(r.createdAt)}</div>
                    </div>
                    <div style={styles.actions}>
                      <button onClick={() => cancelRequest(r.id)} style={styles.btnDecline} title="Cancel request">Cancel</button>
                    </div>
                  </div>
                ))}
              </>
            )}

            {incomingRequests.length === 0 && outgoingRequests.length === 0 && (
              <p style={styles.empty}>No pending friend requests.</p>
            )}
          </>
        )}

        {tab === 'blocked' && (
          blockedUsers.length === 0 ? (
            <p style={styles.empty}>No blocked users.</p>
          ) : (
            blockedUsers.map((b) => (
              <div key={b.blockedPublicKey} style={styles.row}>
                <div style={styles.avatar}>{(b.blockedUsername || '??').slice(0, 2).toUpperCase()}</div>
                <div style={styles.info}>
                  <div style={styles.name}>{b.blockedUsername || b.blockedPublicKey.slice(0, 16) + '\u2026'}</div>
                  <div style={styles.since}>Blocked {new Date(b.blockedAt).toLocaleDateString()}</div>
                </div>
                <div style={styles.actions}>
                  <button onClick={() => unblockUser(b.blockedPublicKey)} style={styles.btnAccept} title="Unblock">Unblock</button>
                </div>
              </div>
            ))
          )
        )}
      </div>
    </div>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const styles = {
  container: { display: 'flex', flexDirection: 'column' as const, height: '100%', background: 'var(--color-bg-primary)' } as React.CSSProperties,
  header: { padding: '14px 16px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 } as React.CSSProperties,
  title: { fontSize: '16px', fontWeight: 600 } as React.CSSProperties,
  addRow: { display: 'flex', gap: '6px', padding: '10px 16px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 } as React.CSSProperties,
  addInput: { flex: 1, padding: '8px 12px', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', fontSize: '13px', outline: 'none', fontFamily: 'inherit' } as React.CSSProperties,
  addBtn: { padding: '8px 16px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: '13px', fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  message: { padding: '6px 16px', fontSize: '12px', color: 'var(--color-accent)', background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' } as React.CSSProperties,
  tabs: { display: 'flex', borderBottom: '1px solid var(--color-border)', flexShrink: 0 } as React.CSSProperties,
  tab: { flex: 1, padding: '10px', background: 'transparent', border: 'none', borderBottom: '2px solid transparent', color: 'var(--color-text-muted)', fontSize: '12px', fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  tabActive: { flex: 1, padding: '10px', background: 'transparent', border: 'none', borderBottom: '2px solid var(--color-accent)', color: 'var(--color-accent)', fontSize: '12px', fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  content: { flex: 1, overflowY: 'auto' as const, padding: '8px 0' } as React.CSSProperties,
  empty: { textAlign: 'center' as const, color: 'var(--color-text-muted)', fontSize: '13px', padding: '32px 16px' } as React.CSSProperties,
  sectionLabel: { fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', padding: '8px 16px 4px' } as React.CSSProperties,
  row: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 16px', transition: 'background 0.1s' } as React.CSSProperties,
  avatar: { width: '36px', height: '36px', borderRadius: '50%', background: 'var(--color-bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 600, flexShrink: 0, color: 'var(--color-text-secondary)' } as React.CSSProperties,
  info: { flex: 1, minWidth: 0 } as React.CSSProperties,
  name: { fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } as React.CSSProperties,
  userTag: { fontSize: '11px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', marginLeft: '6px' } as React.CSSProperties,
  since: { fontSize: '11px', color: 'var(--color-text-muted)' } as React.CSSProperties,
  actions: { display: 'flex', gap: '4px', flexShrink: 0 } as React.CSSProperties,
  btnAccept: { padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'transparent', color: '#1D9E75', cursor: 'pointer', fontSize: '12px', fontWeight: 500 } as React.CSSProperties,
  btnDecline: { padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '12px' } as React.CSSProperties,
  btnBlock: { padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'transparent', color: '#E24B4A', cursor: 'pointer', fontSize: '12px' } as React.CSSProperties,
  btnDanger: { width: '28px', height: '28px', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'transparent', color: '#E24B4A', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' } as React.CSSProperties,
} as const;
