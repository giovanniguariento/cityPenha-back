import pinoHttp from 'pino-http';
import type { Request, Response } from 'express';
import { logger } from '../lib/logger';

export const requestLogger = pinoHttp({
  logger,
  customLogLevel(
    _req: Request,
    res: Response,
    err?: Error
  ): 'silent' | 'error' | 'warn' | 'info' {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customProps(req: Request) {
    return {
      userId: req.appUser?.id,
    };
  },
  serializers: {
    req(req: Request) {
      return {
        method: req.method,
        url: req.url,
      };
    },
    res(res: Response) {
      return {
        statusCode: res.statusCode,
      };
    },
  },
});
