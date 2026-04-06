/**
 * Post Database — R12
 *
 * Tables:
 *   posts    — community posts (title, body, pinned, timestamps)
 *   comments — threaded comments on posts
 */

import type Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

export interface DBPost {
  id: string;
  communityId: string;
  authorPublicKey: string;
  authorUsername: string;
  title: string;
  body: string;
  pinned: number;          // 0 or 1 (SQLite boolean)
  commentCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface DBComment {
  id: string;
  postId: string;
  authorPublicKey: string;
  authorUsername: string;
  content: string;
  createdAt: number;
}

function initPostTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id              TEXT PRIMARY KEY,
      communityId     TEXT NOT NULL,
      authorPublicKey TEXT NOT NULL,
      authorUsername   TEXT NOT NULL,
      title           TEXT NOT NULL,
      body            TEXT NOT NULL DEFAULT '',
      pinned          INTEGER NOT NULL DEFAULT 0,
      commentCount    INTEGER NOT NULL DEFAULT 0,
      createdAt       INTEGER NOT NULL,
      updatedAt       INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_posts_community ON posts (communityId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_posts_pinned ON posts (communityId, pinned);

    CREATE TABLE IF NOT EXISTS comments (
      id              TEXT PRIMARY KEY,
      postId          TEXT NOT NULL,
      authorPublicKey TEXT NOT NULL,
      authorUsername   TEXT NOT NULL,
      content         TEXT NOT NULL,
      createdAt       INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (postId, createdAt);
  `);
}

export class PostDB {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    initPostTables(db);
    console.log('[relay-db] Post tables initialized.');
  }

  // =================================================================
  // Posts
  // =================================================================

  createPost(communityId: string, authorKey: string, authorUser: string, title: string, body: string): DBPost {
    const id = randomBytes(16).toString('hex');
    const now = Date.now();
    const post: DBPost = {
      id, communityId, authorPublicKey: authorKey, authorUsername: authorUser,
      title, body, pinned: 0, commentCount: 0, createdAt: now, updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO posts (id, communityId, authorPublicKey, authorUsername, title, body, pinned, commentCount, createdAt, updatedAt)
      VALUES (@id, @communityId, @authorPublicKey, @authorUsername, @title, @body, @pinned, @commentCount, @createdAt, @updatedAt)
    `).run(post);

    console.log(`[post-db] Post created: "${title}" by ${authorUser} in ${communityId.slice(0, 8)}`);
    return post;
  }

  getPosts(communityId: string, offset = 0, limit = 50): { posts: DBPost[]; total: number } {
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM posts WHERE communityId = ?').get(communityId) as any).c;
    // Pinned posts first, then by createdAt desc
    const posts = this.db.prepare(`
      SELECT * FROM posts WHERE communityId = ?
      ORDER BY pinned DESC, createdAt DESC
      LIMIT ? OFFSET ?
    `).all(communityId, limit, offset) as DBPost[];
    return { posts, total };
  }

  getPost(postId: string): DBPost | undefined {
    return this.db.prepare('SELECT * FROM posts WHERE id = ?').get(postId) as DBPost | undefined;
  }

  deletePost(postId: string): boolean {
    // Delete comments first
    this.db.prepare('DELETE FROM comments WHERE postId = ?').run(postId);
    const result = this.db.prepare('DELETE FROM posts WHERE id = ?').run(postId);
    if (result.changes > 0) console.log(`[post-db] Post deleted: ${postId}`);
    return result.changes > 0;
  }

  pinPost(postId: string, pinned: boolean): boolean {
    const result = this.db.prepare('UPDATE posts SET pinned = ?, updatedAt = ? WHERE id = ?')
      .run(pinned ? 1 : 0, Date.now(), postId);
    return result.changes > 0;
  }

  /** Delete all posts and comments for a community (used when community is deleted). */
  deleteAllForCommunity(communityId: string): number {
    const postIds = this.db.prepare('SELECT id FROM posts WHERE communityId = ?').all(communityId) as Array<{ id: string }>;
    for (const p of postIds) {
      this.db.prepare('DELETE FROM comments WHERE postId = ?').run(p.id);
    }
    const result = this.db.prepare('DELETE FROM posts WHERE communityId = ?').run(communityId);
    return result.changes;
  }

  // =================================================================
  // Comments
  // =================================================================

  addComment(postId: string, authorKey: string, authorUser: string, content: string): DBComment | null {
    const post = this.getPost(postId);
    if (!post) return null;

    const id = randomBytes(16).toString('hex');
    const now = Date.now();
    const comment: DBComment = { id, postId, authorPublicKey: authorKey, authorUsername: authorUser, content, createdAt: now };

    this.db.prepare(`
      INSERT INTO comments (id, postId, authorPublicKey, authorUsername, content, createdAt)
      VALUES (@id, @postId, @authorPublicKey, @authorUsername, @content, @createdAt)
    `).run(comment);

    // Increment comment count
    this.db.prepare('UPDATE posts SET commentCount = commentCount + 1, updatedAt = ? WHERE id = ?')
      .run(now, postId);

    console.log(`[post-db] Comment by ${authorUser} on post ${postId.slice(0, 8)}`);
    return comment;
  }

  getComments(postId: string): DBComment[] {
    return this.db.prepare('SELECT * FROM comments WHERE postId = ? ORDER BY createdAt ASC')
      .all(postId) as DBComment[];
  }

  getPostCount(communityId: string): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM posts WHERE communityId = ?').get(communityId) as any).c;
  }
}
