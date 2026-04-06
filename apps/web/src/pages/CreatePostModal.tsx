/**
 * CreatePostModal — R12
 *
 * Simple modal for creating a new post (title + body).
 */

import React, { useState } from 'react';
import { usePostStore } from '../stores/postStore.js';

interface Props {
  communityId: string;
  onClose: () => void;
}

export default function CreatePostModal({ communityId, onClose }: Props): React.JSX.Element {
  const { createPost, loading } = usePostStore();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const handleSubmit = () => {
    if (!title.trim()) return;
    createPost(communityId, title.trim(), body.trim());
    onClose();
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.header}>
          <span style={s.headerTitle}>New post</span>
          <button onClick={onClose} style={s.closeBtn}>&#x2715;</button>
        </div>

        <div style={s.body}>
          <label style={s.label}>
            Title
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Post title"
              maxLength={200}
              autoFocus
              style={s.input}
            />
          </label>

          <label style={s.label}>
            Body <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(optional)</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write something..."
              maxLength={10000}
              rows={6}
              style={{ ...s.input, resize: 'vertical' as const }}
            />
            <span style={s.charCount}>{body.length}/10,000</span>
          </label>
        </div>

        <div style={s.footer}>
          <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading || !title.trim()}>
            {loading ? 'Posting...' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
}

const s = {
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 } as React.CSSProperties,
  modal: { background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '520px', overflow: 'hidden', maxHeight: '90vh', display: 'flex', flexDirection: 'column' as const } as React.CSSProperties,
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 } as React.CSSProperties,
  headerTitle: { fontSize: '16px', fontWeight: 600 } as React.CSSProperties,
  closeBtn: { background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '16px', padding: '4px' } as React.CSSProperties,
  body: { padding: '20px', display: 'flex', flexDirection: 'column' as const, gap: '16px', overflowY: 'auto' as const, flex: 1 } as React.CSSProperties,
  label: { display: 'flex', flexDirection: 'column' as const, gap: '6px', fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 } as React.CSSProperties,
  input: { width: '100%', padding: '10px 12px', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)', outline: 'none', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' as const } as React.CSSProperties,
  charCount: { fontSize: '10px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', alignSelf: 'flex-end' as const } as React.CSSProperties,
  footer: { display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '16px 20px', borderTop: '1px solid var(--color-border)', flexShrink: 0 } as React.CSSProperties,
} as const;
