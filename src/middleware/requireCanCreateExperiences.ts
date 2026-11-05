import type { Request, Response, NextFunction } from 'express';
import { forbidden } from '../lib/httpErrors';

/** Requires `req.appUser.canCreateExperiences`. Does not require a WordPress account. */
export function requireCanCreateExperiences(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const user = req.appUser;
  if (!user?.canCreateExperiences) {
    next(forbidden('User is not allowed to create experiences'));
    return;
  }
  next();
}
