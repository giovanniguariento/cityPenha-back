import type { Request, Response, NextFunction } from 'express';
import { internalError, isHttpError } from '../lib/httpErrors';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (res.headersSent) {
    return;
  }

  if (isHttpError(err)) {
    if (err.statusCode >= 500) {
      console.error(err.stack ?? err.message);
    }
    res.status(err.statusCode).json(err.toBody());
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  console.error(err instanceof Error ? err.stack ?? err.message : err);

  const isProd = process.env.NODE_ENV === 'production';
  const safe = internalError(isProd ? 'An unexpected error occurred' : message);
  res.status(safe.statusCode).json(safe.toBody());
}
