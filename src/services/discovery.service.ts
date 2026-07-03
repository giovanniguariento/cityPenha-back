import { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { brazilDayUtcBounds, brazilTodayYyyyMmDd } from '../lib/brTime';
import {
  DISCOVERY_LIMIT_POPULAR_AUTHORS,
  DISCOVERY_LIMIT_TRENDING,
  DISCOVERY_LIMIT_WORLD_NEWS,
  WORLD_NEWS_CATEGORY_IDS,
} from '../config/discovery';
import { ETypePost, type IPost } from '../models/post.interface';
import { enrichFeedItemCategory, fetchPostOrAd, toFeedItem } from '../helpers/post.helper';
import { formatPublishedRelativePtBr } from '../helpers/relativeTimePt.helper';
import { gravatarUrlFromEmail } from '../helpers/gravatar.helper';
import { getPublishPressAuthorAvatarUrl } from '../helpers/publishPressAuthors.helper';
import { resolveDefaultAuthorAvatarUrl } from '../helpers/wordpressDefaultAvatar.helper';
import type {
  DiscoveryPopularAuthor,
  DiscoveryResponse,
  DiscoveryTopicCategory,
  FeedItem,
} from '../types';
import { WordpressService, wordpressService } from './wordpress.service';
import { SYSTEM_FOLDER_KEY_LIKES } from './postFolder.service';
import { postViewService } from './postView.service';

export class DiscoveryService {
  constructor(private readonly wordpressService: WordpressService) {}

  /**
   * Parses optional `worldNewsCategories` query: comma-separated numeric IDs and/or category slugs.
   * When absent or blank, uses `WORLD_NEWS_CATEGORY_IDS` from config/env.
   */
  async resolveWorldNewsCategoryIds(queryParam: string | undefined): Promise<number[]> {
    if (typeof queryParam !== 'string' || !queryParam.trim()) {
      return [...WORLD_NEWS_CATEGORY_IDS];
    }
    const tokens = queryParam
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const ids: number[] = [];
    for (const token of tokens) {
      if (/^\d+$/.test(token)) {
        ids.push(Number(token));
      } else {
        const id = await this.wordpressService.getCategoryIdBySlug(token);
        if (id != null) ids.push(id);
      }
    }
    return ids.length > 0 ? ids : [...WORLD_NEWS_CATEGORY_IDS];
  }

  async buildDiscoveryPayload(options: {
    worldNewsCategoriesQuery: string | undefined;
    userId: string | undefined;
  }): Promise<DiscoveryResponse> {
    const worldNewsCategoryIds = await this.resolveWorldNewsCategoryIds(
      options.worldNewsCategoriesQuery
    );

    const [topics, popularAuthors, defaultAvatarUrl] = await Promise.all([
      this.loadTopics(),
      this.loadPopularAuthors(),
      resolveDefaultAuthorAvatarUrl(),
    ]);

    const [worldPosts, trendingFeedItems] = await Promise.all([
      this.loadWorldNews(worldNewsCategoryIds, defaultAvatarUrl),
      this.loadTrendingFeedItems(defaultAvatarUrl),
    ]);

    const allFeedItems: FeedItem[] = [...worldPosts, ...trendingFeedItems];
    await this.applyViewedFlags(options.userId, allFeedItems);
    await postViewService.applyViewsCountsToFeedItems(allFeedItems);

    return {
      newExperiences: [],
      editorsChoice: [],
      topics,
      worldNews: worldPosts,
      trendingTopics: trendingFeedItems,
      popularAuthors,
    };
  }

  private async loadTopics(): Promise<DiscoveryTopicCategory[]> {
    const rows = await this.wordpressService.getCategoriesForDiscovery();
    const batchSize = 8;
    const latestUrls: string[] = [];
    for (let i = 0; i < rows.length; i += batchSize) {
      const slice = rows.slice(i, i + batchSize);
      const urls = await Promise.all(
        slice.map((c) =>
          this.wordpressService.getLatestPostFeaturedImageUrlForCategory(c.id)
        )
      );
      latestUrls.push(...urls.map((u) => u ?? ''));
    }
    return rows.map((c, i) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      newsCount: c.count,
      latestPostImageUrl: latestUrls[i] ?? '',
    }));
  }

  private async loadWorldNews(
    categoryIds: number[],
    defaultAvatarUrl: string
  ): Promise<FeedItem[]> {
    if (categoryIds.length === 0) return [];
    const posts = await this.wordpressService.getPostsByCategoryIds(
      categoryIds,
      DISCOVERY_LIMIT_WORLD_NEWS
    );
    const contentPosts = posts.filter((p) => p.type === ETypePost.POST);
    const allCategories = await this.wordpressService.getCategories();
    const categoryById = new Map(allCategories.map((c) => [c.id, c]));

    return contentPosts.map((post) => {
      const item = toFeedItem(post, defaultAvatarUrl);
      enrichFeedItemCategory(item, categoryById);
      return item;
    });
  }

  /**
   * Trending score = sum (1:1:1) of active likes (`favorites` in likes folder),
   * logged reads (`read_posts`) and anonymous views (`post_views`) per post.
   * Uses `$queryRaw` because Prisma `groupBy` cannot order by aggregate count on these models.
   *
   * 1) Today (Brazil): events with `createdAt` in `[start, endExclusive)`.
   * 2) If no rows today: all-time only (same query without date filter).
   * 3) If there are rows today but fewer than the limit: append top all-time posts
   *    (excluding IDs already chosen) until the limit.
   */
  private async loadTrendingFeedItems(defaultAvatarUrl: string): Promise<FeedItem[]> {
    const limit = DISCOVERY_LIMIT_TRENDING;
    const todayYmd = brazilTodayYyyyMmDd();
    const { start, endExclusive } = brazilDayUtcBounds(todayYmd);

    let rows = await this.queryTrendingPostIds({ limit, start, endExclusive });

    if (rows.length === 0) {
      rows = await this.queryTrendingPostIds({ limit });
    } else if (rows.length < limit) {
      const excludeIds = rows.map((r) => r.wordpressPostId);
      const need = limit - rows.length;
      const more = await this.queryTrendingPostIds({ limit: need, excludeIds });
      rows = [...rows, ...more];
    }

    const ids = rows.map((r) => r.wordpressPostId);
    return this.postIdsToFeedItems(ids, defaultAvatarUrl);
  }

  /**
   * Ranks posts by engagement score: each like, logged read and anonymous view counts as 1.
   * Sources: `favorites` (likes folder) + `read_posts` + `post_views`.
   */
  private async queryTrendingPostIds(options: {
    limit: number;
    start?: Date;
    endExclusive?: Date;
    excludeIds?: number[];
  }): Promise<Array<{ wordpressPostId: number }>> {
    const { limit, start, endExclusive, excludeIds = [] } = options;
    const hasDateFilter = start != null && endExclusive != null;
    const hasExclude = excludeIds.length > 0;

    const favoritesDateFilter = hasDateFilter
      ? Prisma.sql`AND f.createdAt >= ${start} AND f.createdAt < ${endExclusive}`
      : Prisma.sql``;
    const readsDateFilter = hasDateFilter
      ? Prisma.sql`AND rp.createdAt >= ${start} AND rp.createdAt < ${endExclusive}`
      : Prisma.sql``;
    const viewsDateFilter = hasDateFilter
      ? Prisma.sql`AND pv.createdAt >= ${start} AND pv.createdAt < ${endExclusive}`
      : Prisma.sql``;

    const favoritesExclude = hasExclude
      ? Prisma.sql`AND f.wordpressPostId NOT IN (${Prisma.join(
          excludeIds.map((id) => Prisma.sql`${id}`)
        )})`
      : Prisma.sql``;
    const readsExclude = hasExclude
      ? Prisma.sql`AND rp.wordpressPostId NOT IN (${Prisma.join(
          excludeIds.map((id) => Prisma.sql`${id}`)
        )})`
      : Prisma.sql``;
    const viewsExclude = hasExclude
      ? Prisma.sql`AND pv.wordpressPostId NOT IN (${Prisma.join(
          excludeIds.map((id) => Prisma.sql`${id}`)
        )})`
      : Prisma.sql``;

    return prisma.$queryRaw<Array<{ wordpressPostId: number }>>(
      Prisma.sql`
        SELECT events.wordpressPostId AS wordpressPostId
        FROM (
          SELECT f.wordpressPostId AS wordpressPostId
          FROM favorites f
          INNER JOIN post_folders pf
            ON pf.id = f.folderId
            AND pf.internalKey = ${SYSTEM_FOLDER_KEY_LIKES}
          WHERE 1 = 1
            ${favoritesDateFilter}
            ${favoritesExclude}

          UNION ALL

          SELECT rp.wordpressPostId AS wordpressPostId
          FROM read_posts rp
          WHERE 1 = 1
            ${readsDateFilter}
            ${readsExclude}

          UNION ALL

          SELECT pv.wordpressPostId AS wordpressPostId
          FROM post_views pv
          WHERE 1 = 1
            ${viewsDateFilter}
            ${viewsExclude}
        ) AS events
        GROUP BY events.wordpressPostId
        ORDER BY COUNT(*) DESC, events.wordpressPostId ASC
        LIMIT ${limit}
      `
    );
  }

  private async postIdsToFeedItems(
    wordpressPostIds: number[],
    defaultAvatarUrl: string
  ): Promise<FeedItem[]> {
    const items: FeedItem[] = [];
    const allCategories = await this.wordpressService.getCategories();
    const categoryById = new Map(allCategories.map((c) => [c.id, c]));

    for (const id of wordpressPostIds) {
      const post = await fetchPostOrAd(this.wordpressService, id);
      if (!post) continue;

      const item = toFeedItem(post, defaultAvatarUrl);
      item.publishedAtRelative = formatPublishedRelativePtBr(post.date);
      enrichFeedItemCategory(item, categoryById);
      items.push(item);
    }
    return items;
  }

  /**
   * Popular authors: sum of in-app likes (`favorites` in `post_folders` with `internalKey = 'likes'`)
   * for published `post` rows in `wp_posts`, grouped by `post_author`.
   *
   * Raw SQL (MySQL): join `favorites` f → `post_folders` pf (`pf.internalKey` = likes) → `wp_posts` wp
   * on `wp.ID` = `f.wordpressPostId`; filter `wp.post_type` = 'post', `wp.post_status` = 'publish';
   * `GROUP BY wp.post_author`, `ORDER BY totalLikes DESC`, `LIMIT`.
   *
   * Avatar: PublishPress Authors — `wp_termmeta` (`user_id_{wpUserId}` → author term, then `avatar` = attachment id) + `wp_posts.guid`; fallback Gravatar from `user_email`.
   */
  private async loadPopularAuthors(): Promise<DiscoveryPopularAuthor[]> {
    const limit = DISCOVERY_LIMIT_POPULAR_AUTHORS;

    const rows = await prisma.$queryRaw<
      Array<{ post_author: bigint; totalLikes: bigint }>
    >(Prisma.sql`
      SELECT
        wp.post_author AS post_author,
        COUNT(f.id) AS totalLikes
      FROM favorites f
      INNER JOIN post_folders pf
        ON pf.id = f.folderId
        AND pf.internalKey = ${SYSTEM_FOLDER_KEY_LIKES}
      INNER JOIN wp_posts wp
        ON wp.ID = f.wordpressPostId
      WHERE wp.post_type = 'post'
        AND wp.post_status = 'publish'
      GROUP BY wp.post_author
      ORDER BY totalLikes DESC
      LIMIT ${limit}
    `);

    if (rows.length === 0) return [];

    const authorIds = rows.map((r) => r.post_author);
    const users = await prisma.wp_users.findMany({
      where: { ID: { in: authorIds } },
      select: { ID: true, display_name: true, user_email: true },
    });
    const nameById = new Map(users.map((u) => [u.ID, u.display_name ?? '']));
    const emailById = new Map(users.map((u) => [u.ID, u.user_email ?? '']));

    const ppmaAvatars = await Promise.all(
      rows.map((r) => getPublishPressAuthorAvatarUrl(Number(r.post_author)))
    );

    return rows.map((r, i) => {
      const id = Number(r.post_author);
      const email = emailById.get(r.post_author) ?? '';
      const fromPpma = ppmaAvatars[i];
      return {
        wordpressUserId: id,
        name: nameById.get(r.post_author) ?? '',
        avatarUrl: fromPpma ?? gravatarUrlFromEmail(email),
        totalLikes: Number(r.totalLikes),
      };
    });
  }

  private async applyViewedFlags(userId: string | undefined, items: FeedItem[]): Promise<void> {
    if (!userId || items.length === 0) {
      for (const item of items) item.viewed = false;
      return;
    }
    const ids = [...new Set(items.map((i) => i.id))];
    const readRecords = await prisma.readPost.findMany({
      where: { userId, wordpressPostId: { in: ids } },
      select: { wordpressPostId: true },
    });
    const readSet = new Set(readRecords.map((r) => r.wordpressPostId));
    for (const item of items) {
      item.viewed = readSet.has(item.id);
    }
  }
}

export const discoveryService = new DiscoveryService(wordpressService);
