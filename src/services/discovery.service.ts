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
import { toFeedItem } from '../helpers/post.helper';
import { formatPublishedRelativePtBr } from '../helpers/relativeTimePt.helper';
import { gravatarUrlFromEmail } from '../helpers/gravatar.helper';
import { getPublishPressAuthorAvatarUrl } from '../helpers/publishPressAuthors.helper';
import type {
  DiscoveryPopularAuthor,
  DiscoveryResponse,
  DiscoveryTopicCategory,
  FeedItem,
} from '../types';
import { WordpressService, wordpressService } from './wordpress.service';
import { SYSTEM_FOLDER_KEY_LIKES } from './postFolder.service';

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

    const [topics, worldPosts, trendingFeedItems, popularAuthors] = await Promise.all([
      this.loadTopics(),
      this.loadWorldNews(worldNewsCategoryIds),
      this.loadTrendingFeedItems(),
      this.loadPopularAuthors(),
    ]);

    const allFeedItems: FeedItem[] = [...worldPosts, ...trendingFeedItems];
    await this.applyViewedFlags(options.userId, allFeedItems);

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

  private async loadWorldNews(categoryIds: number[]): Promise<FeedItem[]> {
    if (categoryIds.length === 0) return [];
    const posts = await this.wordpressService.getPostsByCategoryIds(
      categoryIds,
      DISCOVERY_LIMIT_WORLD_NEWS
    );
    const contentPosts = posts.filter((p) => p.type === ETypePost.POST);
    const allCategories = await this.wordpressService.getCategories();
    const categoryNameById = new Map(allCategories.map((c) => [c.id, c.name]));

    return contentPosts.map((post) => {
      const item = toFeedItem(post);
      for (const id of item.categories) {
        const name = categoryNameById.get(id);
        if (name) {
          item.categoryName = name;
          break;
        }
      }
      return item;
    });
  }

  /**
   * Trending: `read_posts` grouped by `wordpressPostId`, ordered by read count desc.
   * Prisma `groupBy` cannot `orderBy` aggregate `_count._all` for this model (see `ReadPostOrderByWithAggregationInput`), so we use `$queryRaw`.
   *
   * 1) Today (Brazil): `createdAt` in `[start, endExclusive)` from `brazilDayUtcBounds(brazilTodayYyyyMmDd())`.
   * 2) If no rows: same without date filter (all-time).
   */
  private async loadTrendingFeedItems(): Promise<FeedItem[]> {
    const limit = DISCOVERY_LIMIT_TRENDING;
    const todayYmd = brazilTodayYyyyMmDd();
    const { start, endExclusive } = brazilDayUtcBounds(todayYmd);

    /*
     * Trending (today): `read_posts` — filter `createdAt` between Brazil-day UTC bounds;
     * `GROUP BY wordpressPostId`; `ORDER BY COUNT(*) DESC`; `LIMIT`.
     */
    let rows = await prisma.$queryRaw<Array<{ wordpressPostId: number }>>(
      Prisma.sql`
        SELECT rp.wordpressPostId AS wordpressPostId
        FROM read_posts rp
        WHERE rp.createdAt >= ${start}
          AND rp.createdAt < ${endExclusive}
        GROUP BY rp.wordpressPostId
        ORDER BY COUNT(*) DESC
        LIMIT ${limit}
      `
    );

    if (rows.length === 0) {
      /*
       * Trending (fallback / all-time): same on `read_posts` without `createdAt` filter.
       */
      rows = await prisma.$queryRaw<Array<{ wordpressPostId: number }>>(
        Prisma.sql`
          SELECT rp.wordpressPostId AS wordpressPostId
          FROM read_posts rp
          GROUP BY rp.wordpressPostId
          ORDER BY COUNT(*) DESC
          LIMIT ${limit}
        `
      );
    }

    const ids = rows.map((r) => r.wordpressPostId);
    return this.postIdsToFeedItems(ids);
  }

  private async postIdsToFeedItems(wordpressPostIds: number[]): Promise<FeedItem[]> {
    const items: FeedItem[] = [];
    const allCategories = await this.wordpressService.getCategories();
    const categoryNameById = new Map(allCategories.map((c) => [c.id, c.name]));

    for (const id of wordpressPostIds) {
      try {
        const post: IPost = await this.wordpressService.getPost(id);
        if (post.type !== ETypePost.POST) continue;
        const item = toFeedItem(post);
        item.publishedAtRelative = formatPublishedRelativePtBr(post.date);
        for (const cid of item.categories) {
          const name = categoryNameById.get(cid);
          if (name) {
            item.categoryName = name;
            break;
          }
        }
        items.push(item);
      } catch {
        /* skip missing posts */
      }
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
