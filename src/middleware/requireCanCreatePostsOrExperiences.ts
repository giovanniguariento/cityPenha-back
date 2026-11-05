import type { Request, Response, NextFunction } from 'express';
import { forbidden } from '../lib/httpErrors';

/**
 * Allows either post creators or experience creators.
 * Used for shared read-only resources (e.g. WordPress category list for pickers).
 * Does not require a linked WordPress author account.
 */
export function requireCanCreatePostsOrExperiences(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const user = req.appUser;
  if (user?.canCreatePosts || user?.canCreateExperiences) {
    next();
    return;
  }
  next(forbidden('User is not allowed to list categories'));
}
