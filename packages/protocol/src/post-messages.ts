/**
 * Post / Feed Protocol Messages — R12
 *
 * ADD to packages/protocol/src/ and re-export from index.ts:
 *   export * from './post-messages.js';
 */

// =================================================================
// Data types
// =================================================================

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

// =================================================================
// Client → Relay
// =================================================================

export interface CreatePostMsg {
  type: 'CREATE_POST';
  payload: {
    communityId: string;
    title: string;
    body: string;
  };
  timestamp: number;
}

export interface GetPostsMsg {
  type: 'GET_POSTS';
  payload: {
    communityId: string;
    offset?: number;
    limit?: number;
  };
  timestamp: number;
}

export interface DeletePostMsg {
  type: 'DELETE_POST';
  payload: {
    communityId: string;
    postId: string;
  };
  timestamp: number;
}

export interface PinPostMsg {
  type: 'PIN_POST';
  payload: {
    communityId: string;
    postId: string;
    pinned: boolean;
  };
  timestamp: number;
}

export interface AddCommentMsg {
  type: 'ADD_COMMENT';
  payload: {
    postId: string;
    content: string;
  };
  timestamp: number;
}

export interface GetCommentsMsg {
  type: 'GET_COMMENTS';
  payload: {
    postId: string;
  };
  timestamp: number;
}

// =================================================================
// Relay → Client
// =================================================================

export interface PostCreatedMsg {
  type: 'POST_CREATED';
  payload: Post;
  timestamp: number;
}

export interface PostListMsg {
  type: 'POST_LIST';
  payload: {
    communityId: string;
    posts: Post[];
    total: number;
  };
  timestamp: number;
}

export interface PostDeletedMsg {
  type: 'POST_DELETED';
  payload: {
    communityId: string;
    postId: string;
  };
  timestamp: number;
}

export interface PostPinnedMsg {
  type: 'POST_PINNED';
  payload: {
    communityId: string;
    postId: string;
    pinned: boolean;
  };
  timestamp: number;
}

export interface CommentAddedMsg {
  type: 'COMMENT_ADDED';
  payload: PostComment & { communityId: string };
  timestamp: number;
}

export interface CommentListMsg {
  type: 'COMMENT_LIST';
  payload: {
    postId: string;
    comments: PostComment[];
  };
  timestamp: number;
}

export interface PostResultMsg {
  type: 'POST_RESULT';
  payload: {
    action: string;
    success: boolean;
    message?: string;
  };
  timestamp: number;
}
