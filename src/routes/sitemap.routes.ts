import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { sendJsonSuccess } from '../lib/apiResponse';
import { listSitemapPosts } from '../services/sitemap.service';

const router = Router();

/**
 * GET /sitemap/posts — public list of published posts for the frontend sitemap.xml generator.
 */
router.get(
  '/posts',
  asyncHandler(async (_req: Request, res: Response) => {
    const posts = await listSitemapPosts();
    sendJsonSuccess(res, { posts });
  })
);

export default router;
