import { prisma } from '../lib/prisma';
import { formatPublishedRelativePtBr } from '../helpers/relativeTimePt.helper';
import { notFound } from '../lib/httpErrors';
import type { CommentView } from '../types';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_CONTENT_LENGTH = 2000;

export interface ListOptions {
  cursor?: string;
  limit?: number;
}

export interface ListResult {
  comments: CommentView[];
  nextCursor: string | null;
}

function toView(
  comment: {
    id: string;
    content: string;
    createdAt: Date;
    user: { id: string; name: string; nickname: string | null; photoUrl: string | null };
    _count: { likes: number; replies: number };
  },
  viewerId?: string,
  likedIds?: Set<string>
): CommentView {
  const liked = viewerId != null && likedIds != null ? likedIds.has(comment.id) : undefined;
  return {
    id: comment.id,
    content: comment.content,
    author: {
      id: comment.user.id,
      name: comment.user.nickname ?? comment.user.name,
      avatarUrl: comment.user.photoUrl,
    },
    createdAt: comment.createdAt.toISOString(),
    createdAtRelative: formatPublishedRelativePtBr(comment.createdAt),
    likeCount: comment._count.likes,
    replyCount: comment._count.replies,
    liked,
    isOwn: viewerId != null ? comment.user.id === viewerId : undefined,
  };
}

function toReplyView(
  comment: {
    id: string;
    content: string;
    createdAt: Date;
    user: { id: string; name: string; nickname: string | null; photoUrl: string | null };
    _count: { likes: number; replies: number };
  },
  viewerId?: string,
  likedIds?: Set<string>
): CommentView {
  const view = toView(comment, viewerId, likedIds);
  const { replyCount: _rc, ...rest } = view;
  void _rc;
  return rest;
}

async function getLikedIds(viewerId: string, commentIds: string[]): Promise<Set<string>> {
  if (commentIds.length === 0) return new Set();
  const likes = await prisma.commentLike.findMany({
    where: { userId: viewerId, commentId: { in: commentIds } },
    select: { commentId: true },
  });
  return new Set(likes.map((l) => l.commentId));
}

export class CommentService {
  async listTopLevel(
    wordpressPostId: number,
    { cursor, limit }: ListOptions,
    viewerId?: string
  ): Promise<ListResult> {
    const take = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const comments = await prisma.comment.findMany({
      where: { wordpressPostId, parentId: null },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        user: { select: { id: true, name: true, nickname: true, photoUrl: true } },
        _count: { select: { likes: true, replies: true } },
      },
    });

    const hasMore = comments.length > take;
    const page = hasMore ? comments.slice(0, take) : comments;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    const likedIds = viewerId ? await getLikedIds(viewerId, page.map((c) => c.id)) : undefined;

    return {
      comments: page.map((c) => toView(c, viewerId, likedIds)),
      nextCursor,
    };
  }

  async listReplies(
    parentCommentId: string,
    { cursor, limit }: ListOptions,
    viewerId?: string
  ): Promise<ListResult> {
    const parent = await prisma.comment.findUnique({
      where: { id: parentCommentId },
      select: { id: true, parentId: true },
    });
    if (!parent) throw notFound('Comment not found');

    // Replies always target the root comment.
    const rootId = parent.parentId ?? parent.id;

    const take = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const replies = await prisma.comment.findMany({
      where: { parentId: rootId },
      orderBy: { createdAt: 'asc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        user: { select: { id: true, name: true, nickname: true, photoUrl: true } },
        _count: { select: { likes: true, replies: true } },
      },
    });

    const hasMore = replies.length > take;
    const page = hasMore ? replies.slice(0, take) : replies;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    const likedIds = viewerId ? await getLikedIds(viewerId, page.map((c) => c.id)) : undefined;

    return {
      comments: page.map((c) => toReplyView(c, viewerId, likedIds)),
      nextCursor,
    };
  }

  async create(
    userId: string,
    wordpressPostId: number,
    content: string,
    parentId?: string
  ): Promise<CommentView> {
    const trimmed = content.trim();
    if (!trimmed) throw new Error('content_empty');
    if (trimmed.length > MAX_CONTENT_LENGTH) throw new Error('content_too_long');

    // Enforce depth limit: always attach to the root comment.
    let resolvedParentId: string | undefined;
    if (parentId) {
      const parent = await prisma.comment.findUnique({
        where: { id: parentId },
        select: { id: true, parentId: true },
      });
      if (!parent) throw notFound('Parent comment not found');
      resolvedParentId = parent.parentId ?? parent.id;
    }

    const comment = await prisma.comment.create({
      data: {
        userId,
        wordpressPostId,
        content: trimmed,
        parentId: resolvedParentId ?? null,
      },
      include: {
        user: { select: { id: true, name: true, nickname: true, photoUrl: true } },
        _count: { select: { likes: true, replies: true } },
      },
    });

    return toView(comment, userId, new Set());
  }

  async toggleLike(userId: string, commentId: string): Promise<{ liked: boolean; likeCount: number }> {
    const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { id: true } });
    if (!comment) throw notFound('Comment not found');

    const existing = await prisma.commentLike.findUnique({
      where: { commentId_userId: { commentId, userId } },
    });

    if (existing) {
      await prisma.commentLike.delete({ where: { id: existing.id } });
    } else {
      await prisma.commentLike.create({ data: { commentId, userId } });
    }

    const likeCount = await prisma.commentLike.count({ where: { commentId } });
    return { liked: !existing, likeCount };
  }

  async delete(userId: string, commentId: string): Promise<void> {
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { userId: true },
    });
    if (!comment) throw notFound('Comment not found');
    if (comment.userId !== userId) {
      const { forbidden } = await import('../lib/httpErrors');
      throw forbidden('You can only delete your own comments');
    }
    await prisma.comment.delete({ where: { id: commentId } });
  }
}

export const commentService = new CommentService();
