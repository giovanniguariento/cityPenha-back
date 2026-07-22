import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request, Response } from 'express';

function rateLimitBody(message: string) {
  return {
    error: 'TOO_MANY_REQUESTS',
    message,
    details: null,
  };
}

const writeWindowMs = Number(process.env.WRITE_RATE_LIMIT_WINDOW_MS) || 60_000;
const writeMax = Number(process.env.WRITE_RATE_LIMIT_MAX) || 60;

/** General write/mutation rate limit keyed by authenticated user id (fallback: IP). */
export const writeRateLimit = rateLimit({
  windowMs: writeWindowMs,
  max: writeMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.appUser?.id ?? ipKeyGenerator(req.ip ?? ''),
  handler: (_req: Request, res: Response) => {
    res.status(429).json(rateLimitBody('Too many requests, please try again later'));
  },
});

const signupWindowMs = Number(process.env.SIGNUP_RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000;
const signupMax = Number(process.env.SIGNUP_RATE_LIMIT_MAX) || 10;

/** Stricter rate limit for POST /user/signup (per IP). */
export const signupRateLimit = rateLimit({
  windowMs: signupWindowMs,
  max: signupMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res.status(429).json(rateLimitBody('Too many signup attempts, please try again later'));
  },
});

const ogWindowMs = Number(process.env.OG_IMAGE_RATE_LIMIT_WINDOW_MS) || 60_000;
const ogMax = Number(process.env.OG_IMAGE_RATE_LIMIT_MAX) || 30;

/** Rate limit for GET /og-image (CPU + outbound fetch). */
export const ogImageRateLimit = rateLimit({
  windowMs: ogWindowMs,
  max: ogMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    res.status(429).type('text/plain').send('Too many requests');
  },
});
