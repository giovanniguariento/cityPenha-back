import type { Response } from 'express';

/** Feed responses with per-user `viewed` must not be cached as public. */
export function setFeedCacheHeaders(res: Response, isPersonalized: boolean): void {
  if (isPersonalized) {
    res.set('Cache-Control', 'private, no-store');
    res.set('Vary', 'Authorization');
  } else {
    res.set('Cache-Control', 'public, max-age=60');
  }
}
