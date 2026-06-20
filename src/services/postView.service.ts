import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest } from '../lib/httpErrors';
import type { FeedItem } from '../types';

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getVisitorSalt(): string {
  return process.env.VIEW_VISITOR_SALT ?? 'citypenha-default-visitor-salt-change-in-prod';
}

export function hashVisitorKey(visitorId: string): string {
  return createHash('sha256').update(`${visitorId.trim()}:${getVisitorSalt()}`).digest('hex');
}

function isValidVisitorId(visitorId: unknown): visitorId is string {
  return typeof visitorId === 'string' && UUID_V4_RE.test(visitorId.trim());
}

export class PostViewService {
  async getViewsCount(wordpressPostId: number): Promise<number> {
    const [readCount, anonCount] = await Promise.all([
      prisma.readPost.count({ where: { wordpressPostId } }),
      prisma.postView.count({ where: { wordpressPostId } }),
    ]);
    return readCount + anonCount;
  }

  async getViewsCounts(wordpressPostIds: number[]): Promise<Map<number, number>> {
    const uniqueIds = [...new Set(wordpressPostIds)];
    const counts = new Map<number, number>();
    if (uniqueIds.length === 0) return counts;

    for (const id of uniqueIds) counts.set(id, 0);

    const [readGroups, viewGroups] = await Promise.all([
      prisma.readPost.groupBy({
        by: ['wordpressPostId'],
        where: { wordpressPostId: { in: uniqueIds } },
        _count: { _all: true },
      }),
      prisma.postView.groupBy({
        by: ['wordpressPostId'],
        where: { wordpressPostId: { in: uniqueIds } },
        _count: { _all: true },
      }),
    ]);

    for (const row of readGroups) {
      counts.set(row.wordpressPostId, (counts.get(row.wordpressPostId) ?? 0) + row._count._all);
    }
    for (const row of viewGroups) {
      counts.set(row.wordpressPostId, (counts.get(row.wordpressPostId) ?? 0) + row._count._all);
    }

    return counts;
  }

  async applyViewsCountsToFeedItems(items: FeedItem[]): Promise<void> {
    if (items.length === 0) return;
    const ids = [...new Set(items.map((item) => item.id))];
    const counts = await this.getViewsCounts(ids);
    for (const item of items) {
      item.viewsCount = counts.get(item.id) ?? 0;
    }
  }

  async recordAnonymousView(
    wordpressPostId: number,
    visitorId: string
  ): Promise<{ alreadyViewed: boolean }> {
    if (!isValidVisitorId(visitorId)) {
      throw badRequest('Invalid or missing visitorId (expected UUID v4)');
    }

    const visitorKey = hashVisitorKey(visitorId);

    try {
      await prisma.postView.create({
        data: { wordpressPostId, visitorKey },
      });
      return { alreadyViewed: false };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { alreadyViewed: true };
      }
      throw err;
    }
  }
}

export const postViewService = new PostViewService();
