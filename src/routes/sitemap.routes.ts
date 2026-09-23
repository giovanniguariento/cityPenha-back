import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { sendJsonSuccess } from '../lib/apiResponse';
import { listAllPublishedPostSlugs, listSitemapPosts } from '../services/sitemap.service';

const router = Router();

/**
 * GET /sitemap/posts — indexable published posts for sitemap.xml
 * (excludes thin content below the word-count threshold).
 */
router.get(
  '/posts',
  asyncHandler(async (_req: Request, res: Response) => {
    const posts = await listSitemapPosts();
    sendJsonSuccess(res, { posts });
  })
);

/**
 * GET /sitemap/slugs — every published post slug + category (including thin
 * posts). Used by the SSR edge for 301 category canonicalization and 404s.
 */
router.get(
  '/slugs',
  asyncHandler(async (_req: Request, res: Response) => {
    const posts = await listAllPublishedPostSlugs();
    sendJsonSuccess(res, { posts });
  })
);

export default router;
