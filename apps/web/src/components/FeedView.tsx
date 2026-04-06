/**
 * FeedView — R12
 *
 * Displays the community feed: list of posts with inline comments.
 * Pinned posts appear first. Click a post to expand comments.
 */

import React, { useState, useEffect, useRef } from 'react';
import { usePostStore } from '../stores/postStore.js';
import { useNetworkStore } from '../stores/networkStore.js';
import { useCommunityStore } from '../stores/communityStore.js';
import CreatePostModal from '../pages/CreatePostModal.js';

interface Props {
  communityId: string;
}

export default function FeedView({ communityId }: Props): React.JSX.Element {
  const { posts, comments, expandedPostId, lastMessage, loadPosts, deletePost, pinPost, addComment, setExpandedPost, loadComments, clearMessage } = usePostStore();
  const { publicKey: myKey } = useNetworkStore();
  const { communities, myRoles } = useCommunityStore();
  const [showCreate, setShowCreate] = useState(false);
  const [commentText, setCommentText] = useState('');
  const commentInputRef = useRef<HTMLInputElement>(null);

  const communityPosts = posts[communityId] || [];
  const community = communities[communityId];
  const myRole = myRoles[communityId] || 'member';
  const isAdmin = myRole === 'owner' || myRole === 'admin' || myRole === 'moderator';

  useEffect(() => {
    if (communityId) loadPosts(communityId);
  }, [communityId]);

  useEffect(() => {
    if (lastMessage) {
      const t = setTimeout(clearMessage, 4000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [lastMessage]);

  const handleExpand = (postId: string) => {
    if (expandedPostId === postId) {
      setExpandedPost(null);
    } else {
      setExpandedPost(postId);
      setCommentText('');
    }
  };

  const handleComment = (postId: string) => {
    if (!commentText.trim()) return;
    addComment(postId, commentText.trim());
    setCommentText('');
  };

  const handleDelete = (postId: string) => {
    if (confirm('Delete this post and all its comments?')) {
      deletePost(communityId, postId);
    }
  };

  return (
    <div style={s.container}>
      {/* Header */}
      <div style={s.header}>
        <div>
          <span style={s.headerTitle}>Feed</span>
          <span style={s.headerSub}>{community?.name || ''}</span>
        </div>
        <button onClick={() => setShowCreate(true)} style={s.createBtn}>+ New post</button>
      </div>

      {lastMessage && <div style={s.message}>{lastMessage}</div>}

      {/* Post list */}
      <div style={s.feed}>
        {communityPosts.length === 0 ? (
          <div style={s.empty}>
            <p>No posts yet.</p>
            <p style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Be the first to post in this community!</p>
          </div>
        ) : (
          communityPosts.map((post) => {
            const isExpanded = expandedPostId === post.id;
            const postComments = comments[post.id] || [];
            const canDelete = post.authorPublicKey === myKey || isAdmin;
            const canPin = isAdmin;

            return (
              <div key={post.id} style={{ ...s.card, borderLeft: post.pinned ? '3px solid var(--color-accent)' : '3px solid transparent' }}>
                {/* Post header */}
                <div style={s.postHeader}>
                  <div style={s.avatar}>{post.authorUsername.slice(0, 2).toUpperCase()}</div>
                  <div style={s.postMeta}>
                    <span style={s.authorName}>{post.authorUsername}</span>
                    <span style={s.postTime}>{formatTime(post.createdAt)}</span>
                  </div>
                  {post.pinned && <span style={s.pinBadge}>Pinned</span>}
                  <div style={s.postActions}>
                    {canPin && (
                      <button onClick={() => pinPost(communityId, post.id, !post.pinned)} style={s.actionBtn} title={post.pinned ? 'Unpin' : 'Pin'}>
                        {post.pinned ? '\u{1F4CC}' : '\u{1F4CD}'}
                      </button>
                    )}
                    {canDelete && (
                      <button onClick={() => handleDelete(post.id)} style={s.actionBtn} title="Delete">&#x2715;</button>
                    )}
                  </div>
                </div>

                {/* Post content */}
                <h3 style={s.postTitle}>{post.title}</h3>
                {post.body && <p style={s.postBody}>{post.body}</p>}

                {/* Footer: comment count + expand */}
                <button onClick={() => handleExpand(post.id)} style={s.commentToggle}>
                  {post.commentCount > 0
                    ? `${post.commentCount} comment${post.commentCount !== 1 ? 's' : ''}${isExpanded ? ' \u25B2' : ' \u25BC'}`
                    : isExpanded ? 'Hide \u25B2' : 'Comment \u25BC'
                  }
                </button>

                {/* Expanded comments */}
                {isExpanded && (
                  <div style={s.commentsSection}>
                    {postComments.map((c) => (
                      <div key={c.id} style={s.comment}>
                        <span style={s.commentAuthor}>{c.authorUsername}</span>
                        <span style={s.commentText}>{c.content}</span>
                        <span style={s.commentTime}>{formatTime(c.createdAt)}</span>
                      </div>
                    ))}
                    {postComments.length === 0 && (
                      <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', padding: '4px 0' }}>No comments yet.</p>
                    )}
                    <div style={s.commentInput}>
                      <input
                        ref={commentInputRef}
                        type="text"
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleComment(post.id)}
                        placeholder="Write a comment..."
                        style={s.input}
                      />
                      <button
                        onClick={() => handleComment(post.id)}
                        disabled={!commentText.trim()}
                        style={{ ...s.sendBtn, opacity: commentText.trim() ? 1 : 0.5 }}
                      >
                        Send
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {showCreate && (
        <CreatePostModal
          communityId={communityId}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

const s = {
  container: { display: 'flex', flexDirection: 'column' as const, height: '100%', background: 'var(--color-bg-primary)' } as React.CSSProperties,
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 } as React.CSSProperties,
  headerTitle: { fontSize: '16px', fontWeight: 600 } as React.CSSProperties,
  headerSub: { fontSize: '12px', color: 'var(--color-text-muted)', marginLeft: '8px' } as React.CSSProperties,
  createBtn: { padding: '6px 14px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: '12px', fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  message: { padding: '6px 16px', fontSize: '12px', color: 'var(--color-accent)', background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' } as React.CSSProperties,
  feed: { flex: 1, overflowY: 'auto' as const, padding: '12px 16px', display: 'flex', flexDirection: 'column' as const, gap: '10px' } as React.CSSProperties,
  empty: { textAlign: 'center' as const, padding: '48px 16px', color: 'var(--color-text-secondary)', fontSize: '14px' } as React.CSSProperties,
  card: { background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px 16px' } as React.CSSProperties,
  postHeader: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } as React.CSSProperties,
  avatar: { width: '28px', height: '28px', borderRadius: '50%', background: 'var(--color-bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600, flexShrink: 0, color: 'var(--color-text-secondary)' } as React.CSSProperties,
  postMeta: { flex: 1, display: 'flex', alignItems: 'baseline', gap: '6px', minWidth: 0 } as React.CSSProperties,
  authorName: { fontSize: '13px', fontWeight: 500 } as React.CSSProperties,
  postTime: { fontSize: '11px', color: 'var(--color-text-muted)' } as React.CSSProperties,
  pinBadge: { fontSize: '10px', color: 'var(--color-accent)', background: 'var(--color-bg-hover)', padding: '2px 6px', borderRadius: '4px', fontWeight: 500 } as React.CSSProperties,
  postActions: { display: 'flex', gap: '4px' } as React.CSSProperties,
  actionBtn: { width: '24px', height: '24px', borderRadius: '4px', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' } as React.CSSProperties,
  postTitle: { fontSize: '15px', fontWeight: 600, margin: '0 0 4px 0', lineHeight: 1.3 } as React.CSSProperties,
  postBody: { fontSize: '13px', color: 'var(--color-text-secondary)', margin: '0 0 8px 0', lineHeight: 1.5, whiteSpace: 'pre-wrap' as const } as React.CSSProperties,
  commentToggle: { background: 'transparent', border: 'none', color: 'var(--color-text-muted)', fontSize: '12px', cursor: 'pointer', padding: '4px 0' } as React.CSSProperties,
  commentsSection: { borderTop: '1px solid var(--color-border)', marginTop: '8px', paddingTop: '8px' } as React.CSSProperties,
  comment: { display: 'flex', gap: '6px', alignItems: 'baseline', padding: '4px 0', flexWrap: 'wrap' as const } as React.CSSProperties,
  commentAuthor: { fontSize: '12px', fontWeight: 600, flexShrink: 0 } as React.CSSProperties,
  commentText: { fontSize: '12px', color: 'var(--color-text-secondary)' } as React.CSSProperties,
  commentTime: { fontSize: '10px', color: 'var(--color-text-muted)', marginLeft: 'auto' } as React.CSSProperties,
  commentInput: { display: 'flex', gap: '6px', marginTop: '8px' } as React.CSSProperties,
  input: { flex: 1, padding: '6px 10px', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', fontSize: '12px', outline: 'none', fontFamily: 'inherit' } as React.CSSProperties,
  sendBtn: { padding: '6px 12px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: '11px', fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
} as const;
