import { Request, Response, NextFunction } from 'express';
import { ETypePost, type IPost } from '../models/post.interface';
import { WordpressService } from '../services/wordpress.service';
import type { FeedItem } from '../types';
import { toFeedItem } from '../helpers/post.helper';
import { insertAdsIntoPosts } from '../helpers/ad.helper';

export class HomeController {
  constructor(private readonly wordpressService: WordpressService) { }

  getAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [posts, categories, ads] = await Promise.all([
        this.wordpressService.getAllPosts(),
        this.wordpressService.getCategories(),
        this.wordpressService.getAllAds(),
      ]);

      // Ad interval range: default 4..5 (one ad every 4 to 5 posts)
      const intervalMin = Number(process.env.AD_INTERVAL_MIN) || 4;
      const intervalMax = Number(process.env.AD_INTERVAL_MAX) || 5;

      // Prepare carousel: 11 most recent CONTENT posts, then insert ads into that slice.
      const recentContentPosts = posts.filter((p) => p.type === ETypePost.POST).slice(0, 11);
      const carouselWithAds: IPost[] = insertAdsIntoPosts(
        recentContentPosts,
        ads,
        intervalMin,
        intervalMax
      );
      const carousel: FeedItem[] = carouselWithAds.map((post) => toFeedItem(post));

      // Ensure categoryName is set for carousel items
      for (const item of carousel) {
        const cat = categories.find((c) => item.categories.includes(c.id));
        if (cat) item.categoryName = cat.name;
      }

      // Prepare category-based tabs. For each category, take its content posts and insert ads
      const categoriesWithPosts = categories.map((category) => {
        const relatedContentPosts = posts.filter(
          (p) => p.type === ETypePost.POST && p.categories.includes(category.id)
        );
        const listWithAds = insertAdsIntoPosts(
          relatedContentPosts,
          ads,
          intervalMin,
          intervalMax,
          category.id // assign category id to cloned ads so frontend knows the tab context
        );
        const feedItems = listWithAds.map((p) => toFeedItem(p));
        // set categoryName for all items in this list (ads will have categories set to [category.id])
        for (const item of feedItems) {
          const cat = categories.find((c) => item.categories.includes(c.id));
          if (cat) item.categoryName = cat.name;
        }
        return { id: category.id, name: category.name, posts: feedItems };
      });

      if (posts.length === 0 && categories.length === 0) {
        res.status(404).json({ success: false, message: 'Posts not found' });
        return;
      }

      res.set('Cache-Control', 'public, max-age=60');
      res.status(200).json({
        categories: categoriesWithPosts,
        carousel,
      });
    } catch (error) {
      next(error);
    }
  };
}
