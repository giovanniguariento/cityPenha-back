import { prisma } from '../lib/prisma';
import { formatPublishedRelativePtBr } from '../helpers/relativeTimePt.helper';
import { notFound, forbidden } from '../lib/httpErrors';
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
  const likes = await prisma.experienceCommentLike.findMany({
    where: { userId: viewerId, commentId: { in: commentIds } },
    select: { commentId: true },
  });
  return new Set(likes.map((l) => l.commentId));
}

export class ExperienceCommentService {
  async listTopLevel(
    experienceId: string,
    { cursor, limit }: ListOptions,
    viewerId?: string
  ): Promise<ListResult> {
    const take = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const comments = await prisma.experienceComment.findMany({
      where: { experienceId, parentId: null },
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
    const parent = await prisma.experienceComment.findUnique({
      where: { id: parentCommentId },
      select: { id: true, parentId: true },
    });
    if (!parent) throw notFound('Comment not found');

    const rootId = parent.parentId ?? parent.id;
    const take = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const replies = await prisma.experienceComment.findMany({
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
    experienceId: string,
    content: string,
    parentId?: string
  ): Promise<CommentView> {
    const trimmed = content.trim();
    if (!trimmed) throw new Error('content_empty');
    if (trimmed.length > MAX_CONTENT_LENGTH) throw new Error('content_too_long');

    const experience = await prisma.experience.findFirst({
      where: { id: experienceId, status: 'published' },
      select: { id: true },
    });
    if (!experience) throw notFound('Experience not found');

    let resolvedParentId: string | undefined;
    if (parentId) {
      const parent = await prisma.experienceComment.findUnique({
        where: { id: parentId },
        select: { id: true, parentId: true, experienceId: true },
      });
      if (!parent || parent.experienceId !== experienceId) {
        throw notFound('Parent comment not found');
      }
      resolvedParentId = parent.parentId ?? parent.id;
    }

    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.experienceComment.create({
        data: {
          userId,
          experienceId,
          content: trimmed,
          parentId: resolvedParentId ?? null,
        },
        include: {
          user: { select: { id: true, name: true, nickname: true, photoUrl: true } },
          _count: { select: { likes: true, replies: true } },
        },
      });
      await tx.experience.update({
        where: { id: experienceId },
        data: { commentCount: { increment: 1 } },
      });
      return created;
    });

    return toView(comment, userId, new Set());
  }

  async toggleLike(
    userId: string,
    commentId: string
  ): Promise<{ liked: boolean; likeCount: number }> {
    const comment = await prisma.experienceComment.findUnique({
      where: { id: commentId },
      select: { id: true },
    });
    if (!comment) throw notFound('Comment not found');

    const existing = await prisma.experienceCommentLike.findUnique({
      where: { commentId_userId: { commentId, userId } },
    });

    if (existing) {
      await prisma.experienceCommentLike.delete({ where: { id: existing.id } });
    } else {
      await prisma.experienceCommentLike.create({ data: { commentId, userId } });
    }

    const likeCount = await prisma.experienceCommentLike.count({ where: { commentId } });
    return { liked: !existing, likeCount };
  }

  async delete(userId: string, commentId: string): Promise<void> {
    const comment = await prisma.experienceComment.findUnique({
      where: { id: commentId },
      select: { userId: true, experienceId: true },
    });
    if (!comment) throw notFound('Comment not found');
    if (comment.userId !== userId) {
      throw forbidden('You can only delete your own comments');
    }

    const replyCount = await prisma.experienceComment.count({
      where: { parentId: commentId },
    });

    await prisma.$transaction(async (tx) => {
      await tx.experienceComment.delete({ where: { id: commentId } });
      await tx.experience.update({
        where: { id: comment.experienceId },
        data: { commentCount: { decrement: 1 + replyCount } },
      });
    });
  }
}

export const experienceCommentService = new ExperienceCommentService();
