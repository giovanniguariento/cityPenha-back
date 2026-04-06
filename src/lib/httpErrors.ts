import type { ApiErrorBody, ApiErrorCode } from '../types/api';

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode | string;
  readonly details: unknown | null;

  constructor(
    statusCode: number,
    code: ApiErrorCode | string,
    message: string,
    details: unknown | null = null
  ) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  toBody(): ApiErrorBody {
    return {
      error: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}

export function badRequest(message: string, details: unknown | null = null): HttpError {
  return new HttpError(400, 'BAD_REQUEST', message, details);
}

export function validationError(message: string, details: unknown | null = null): HttpError {
  return new HttpError(400, 'VALIDATION_ERROR', message, details);
}

export function unauthorized(message: string, details: unknown | null = null): HttpError {
  return new HttpError(401, 'UNAUTHORIZED', message, details);
}

export function forbidden(message: string, details: unknown | null = null): HttpError {
  return new HttpError(403, 'FORBIDDEN', message, details);
}

export function notFound(message: string, details: unknown | null = null): HttpError {
  return new HttpError(404, 'NOT_FOUND', message, details);
}

export function routeNotFound(message = 'Route not found'): HttpError {
  return new HttpError(404, 'ROUTE_NOT_FOUND', message, null);
}

export function internalError(
  message = 'An unexpected error occurred',
  details: unknown | null = null
): HttpError {
  return new HttpError(500, 'INTERNAL_ERROR', message, details);
}
