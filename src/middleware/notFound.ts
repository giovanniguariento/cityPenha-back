import type { Request, Response, NextFunction } from 'express';
import { routeNotFound } from '../lib/httpErrors';

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(routeNotFound());
}
