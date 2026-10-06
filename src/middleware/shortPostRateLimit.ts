import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request, Response } from 'express';

const windowMs = 60 * 60 * 1000;
const max = Number(process.env.SHORT_POST_RATE_LIMIT) || 10;

/** Per-user rate limit for POST /post/create (keyed by app user id). */
export const shortPostRateLimit = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.appUser?.id ?? ipKeyGenerator(req.ip ?? ''),
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      error: 'TOO_MANY_REQUESTS',
      message: 'Too many short posts, please try again later',
      details: null,
    });
  },
});
