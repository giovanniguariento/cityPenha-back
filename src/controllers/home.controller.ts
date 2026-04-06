import type { Request, Response } from 'express';
import { ETypePost, type IPost } from '../models/post.interface';
import { WordpressService } from '../services/wordpress.service';
import type { FeedItem } from '../types';
import { toFeedItem } from '../helpers/post.helper';
import { insertAdsIntoPosts } from '../helpers/ad.helper';
import { prisma } from '../lib/prisma';
import { sendJsonSuccess } from '../lib/apiResponse';
import { notFound } from '../lib/httpErrors';

export class HomeController {
  constructor(private readonly wordpressService: WordpressService) {}

  getAll = async (req: Request, res: Response): Promise<void> => {
    const [posts, allCategories, ads] = await Promise.all([
      this.wordpressService.getRecentContentPosts(11),
      this.wordpressService.getCategories(),
      this.wordpressService.getAllAds(),
    ]);

    const recentCatsResult =
      await this.wordpressService.getRecentPostsForTopCategories(5, 10, allCategories);

    const categories = recentCatsResult.categories;
    const postsByCategory = recentCatsResult.postsByCategory;
    const categoryNameById = new Map(allCategories.map((c) => [c.id, c.name]));

    const intervalMin = Number(process.env.AD_INTERVAL_MIN) || 4;
    const intervalMax = Number(process.env.AD_INTERVAL_MAX) || 5;

    const recentContentPosts = posts.filter((p) => p.type === ETypePost.POST).slice(0, 11);
    const carouselWithAds: IPost[] = insertAdsIntoPosts(
      recentContentPosts,
      ads,
      intervalMin,
      intervalMax
    );
    const carousel: FeedItem[] = carouselWithAds.map((post) => toFeedItem(post));

    for (const item of carousel) {
      for (const id of item.categories) {
        const name = categoryNameById.get(id);
        if (name) {
          item.categoryName = name;
          break;
        }
      }
    }

    const categoriesWithPosts = categories.map((category) => {
      const relatedContentPosts = (postsByCategory[category.id] || []).filter(
        (p) => p.type === ETypePost.POST
      );
      const listWithAds = insertAdsIntoPosts(
        relatedContentPosts,
        ads,
        intervalMin,
        intervalMax,
        category.id
      );
      const feedItems = listWithAds.map((p) => toFeedItem(p));
      for (const item of feedItems) {
        item.categoryName = category.name;
      }
      return { id: category.id, name: category.name, posts: feedItems };
    });

    const userId = req.appUser?.id;
    if (userId) {
      const allIds = new Set<number>();
      for (const item of carousel) allIds.add(item.id);
      for (const cat of categoriesWithPosts) {
        for (const item of cat.posts) allIds.add(item.id);
      }

      if (allIds.size > 0) {
        const readRecords = await prisma.readPost.findMany({
          where: { userId, wordpressPostId: { in: Array.from(allIds) } },
          select: { wordpressPostId: true },
        });
        const readSet = new Set(readRecords.map((r) => r.wordpressPostId));

        for (const item of carousel) {
          item.viewed = readSet.has(item.id);
        }
        for (const cat of categoriesWithPosts) {
          for (const item of cat.posts) {
            item.viewed = readSet.has(item.id);
          }
        }
      }
    } else {
      for (const item of carousel) item.viewed = false;
      for (const cat of categoriesWithPosts) {
        for (const item of cat.posts) item.viewed = false;
      }
    }

    if (posts.length === 0 && categories.length === 0) {
      throw notFound('Posts not found');
    }

    res.set('Cache-Control', 'public, max-age=60');
    sendJsonSuccess(res, { categories: categoriesWithPosts, carousel });
  };
}
