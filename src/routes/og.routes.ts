import { Router, type Request, type Response } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { createTtlCache } from '../helpers/cache.helper';
import { assertSafeExternalUrl, UnsafeUrlError } from '../helpers/safeUrl.helper';
import { generateOgImage } from '../services/og-image.service';
import { ogImageRateLimit } from '../middleware/writeRateLimit';

const router = Router();

const OG_CACHE_TTL_MS = 30 * 60 * 1000;
const ogImageCache = createTtlCache<Buffer>(OG_CACHE_TTL_MS);

const ogImageQuerySchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).default(''),
  date: z.string().trim().max(64).default(''),
  imageUrl: z.string().url(),
});

function cacheKey(params: z.infer<typeof ogImageQuerySchema>): string {
  return createHash('sha256').update(JSON.stringify(params)).digest('hex');
}

router.get(
  '/',
  ogImageRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = ogImageQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).type('text/plain').send('Invalid query parameters');
      return;
    }

    try {
      assertSafeExternalUrl(parsed.data.imageUrl);
    } catch (err) {
      const message = err instanceof UnsafeUrlError ? err.message : 'Unsafe image URL';
      res.status(400).type('text/plain').send(message);
      return;
    }

    const key = cacheKey(parsed.data);
    const cached = ogImageCache.get(key);
    if (cached) {
      res.set({
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=1800',
      });
      res.send(cached);
      return;
    }

    const image = await generateOgImage(parsed.data);
    ogImageCache.set(key, image);

    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=1800',
    });
    res.send(image);
  }),
);

export default router;
