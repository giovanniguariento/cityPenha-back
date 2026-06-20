import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';

const windowMs = Number(process.env.VIEW_RATE_LIMIT_WINDOW_MS) || 60_000;
const maxPerIp = Number(process.env.VIEW_RATE_LIMIT_PER_IP) || 30;

function rateLimitBody(message: string) {
  return {
    error: 'TOO_MANY_REQUESTS',
    message,
    details: null,
  };
}

/** Rate limit for POST /post/:wordpressPostId/view — per IP. */
export const postViewRateLimit = rateLimit({
  windowMs,
  max: maxPerIp,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res.status(429).json(rateLimitBody('Too many view requests, please try again later'));
  },
});
