import type { Response } from 'express';
import type { ApiSuccessBody } from '../types/api';

export interface SendJsonSuccessOptions {
  status?: number;
  meta?: Record<string, unknown>;
}

export function sendJsonSuccess<T>(
  res: Response,
  data: T,
  options: SendJsonSuccessOptions = {}
): void {
  const { status = 200, meta } = options;
  const body: ApiSuccessBody<T> = { data };
  if (meta !== undefined && Object.keys(meta).length > 0) {
    body.meta = meta;
  }
  res.status(status).json(body);
}
