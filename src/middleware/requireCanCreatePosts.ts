import type { Request, Response, NextFunction } from 'express';
import { forbidden } from '../lib/httpErrors';

/** Requires `req.appUser.canCreatePosts` and a linked `wordpressId`. */
export function requireCanCreatePosts(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const user = req.appUser;
  if (!user?.canCreatePosts) {
    next(forbidden('User is not allowed to create posts'));
    return;
  }
  if (user.wordpressId == null) {
    next(forbidden('User has no WordPress author account'));
    return;
  }
  next();
}
