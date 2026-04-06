/**
 * Post Store — R12
 *
 * Manages community posts and comments.
 * Subscribes to transport messages for real-time updates.
 */

import { create } from 'zustand';
import { useNetworkStore } from './networkStore';
import type { TransportMessage } from '@muster/transport';

export interface Post {
  id: string;
  communityId: string;
  authorPublicKey: string;
  authorUsername: string;
  title: string;
  body: string;
  pinned: boolean;
  commentCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface PostComment {
  id: string;
  postId: string;
  authorPublicKey: string;
  authorUsername: string;
  content: string;
  createdAt: number;
}

interface PostState {
  /** Posts keyed by communityId */
  posts: Record<string, Post[]>;
  /** Comments keyed by postId */
  comments: Record<string, PostComment[]>;
  /** Currently expanded post (showing comments) */
  expandedPostId: string | null;
  lastMessage: string;
  loading: boolean;

  loadPosts: (communityId: string) => void;
  createPost: (communityId: string, title: string, body: string) => void;
  deletePost: (communityId: string, postId: string) => void;
  pinPost: (communityId: string, postId: string, pinned: boolean) => void;
  addComment: (postId: string, content: string) => void;
  loadComments: (postId: string) => void;
  setExpandedPost: (postId: string | null) => void;
  clearMessage: () => void;
  init: () => () => void;
}

export const usePostStore = create<PostState>((set, get) => ({
  posts: {},
  comments: {},
  expandedPostId: null,
  lastMessage: '',
  loading: false,

  loadPosts: (communityId: string) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'GET_POSTS', payload: { communityId }, timestamp: Date.now() });
  },

  createPost: (communityId: string, title: string, body: string) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    set({ loading: true });
    transport.send({ type: 'CREATE_POST', payload: { communityId, title, body }, timestamp: Date.now() });
  },

  deletePost: (communityId: string, postId: string) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'DELETE_POST', payload: { communityId, postId }, timestamp: Date.now() });
  },

  pinPost: (communityId: string, postId: string, pinned: boolean) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'PIN_POST', payload: { communityId, postId, pinned }, timestamp: Date.now() });
  },

  addComment: (postId: string, content: string) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'ADD_COMMENT', payload: { postId, content }, timestamp: Date.now() });
  },

  loadComments: (postId: string) => {
    const { transport } = useNetworkStore.getState();
    if (!transport?.isConnected) return;
    transport.send({ type: 'GET_COMMENTS', payload: { postId }, timestamp: Date.now() });
  },

  setExpandedPost: (postId: string | null) => {
    set({ expandedPostId: postId });
    if (postId) get().loadComments(postId);
  },

  clearMessage: () => set({ lastMessage: '' }),

  init: () => {
    const unsubscribe = useNetworkStore.getState().onMessage((msg: TransportMessage) => {
      switch (msg.type) {
        case 'POST_LIST': {
          const p = msg.payload as any;
          set((s) => ({ posts: { ...s.posts, [p.communityId]: p.posts || [] } }));
          break;
        }
        case 'POST_CREATED': {
          const p = msg.payload as any;
          set((s) => {
            const existing = s.posts[p.communityId] || [];
            if (existing.some((x) => x.id === p.id)) return s;
            // Insert: pinned first, then by date desc
            const updated = [p, ...existing].sort((a, b) => {
              if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
              return b.createdAt - a.createdAt;
            });
            return { posts: { ...s.posts, [p.communityId]: updated }, loading: false };
          });
          break;
        }
        case 'POST_DELETED': {
          const p = msg.payload as any;
          set((s) => ({
            posts: { ...s.posts, [p.communityId]: (s.posts[p.communityId] || []).filter((x) => x.id !== p.postId) },
            expandedPostId: s.expandedPostId === p.postId ? null : s.expandedPostId,
          }));
          break;
        }
        case 'POST_PINNED': {
          const p = msg.payload as any;
          set((s) => {
            const list = (s.posts[p.communityId] || []).map((x) =>
              x.id === p.postId ? { ...x, pinned: p.pinned } : x
            ).sort((a, b) => {
              if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
              return b.createdAt - a.createdAt;
            });
            return { posts: { ...s.posts, [p.communityId]: list } };
          });
          break;
        }
        case 'COMMENT_ADDED': {
          const p = msg.payload as any;
          set((s) => {
            const existing = s.comments[p.postId] || [];
            if (existing.some((c) => c.id === p.id)) return s;
            // Update comment count in posts
            const communityPosts = (s.posts[p.communityId] || []).map((x) =>
              x.id === p.postId ? { ...x, commentCount: x.commentCount + 1 } : x
            );
            return {
              comments: { ...s.comments, [p.postId]: [...existing, p] },
              posts: { ...s.posts, [p.communityId]: communityPosts },
            };
          });
          break;
        }
        case 'COMMENT_LIST': {
          const p = msg.payload as any;
          set((s) => ({ comments: { ...s.comments, [p.postId]: p.comments || [] } }));
          break;
        }
        case 'POST_RESULT': {
          const p = msg.payload as any;
          set({ loading: false, lastMessage: p.message || '' });
          break;
        }
      }
    });

    return unsubscribe;
  },
}));

(window as any).__posts = usePostStore;
