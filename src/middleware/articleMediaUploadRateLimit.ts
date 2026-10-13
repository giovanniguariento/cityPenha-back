import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request, Response } from 'express';

const windowMs = 60 * 60 * 1000;
const max = Number(process.env.ARTICLE_MEDIA_UPLOAD_RATE_LIMIT) || 30;

/** Per-user rate limit for POST /post/media (keyed by app user id). */
export const articleMediaUploadRateLimit = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.appUser?.id ?? ipKeyGenerator(req.ip ?? ''),
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      error: 'TOO_MANY_REQUESTS',
      message: 'Too many media uploads, please try again later',
      details: null,
    });
  },
});
