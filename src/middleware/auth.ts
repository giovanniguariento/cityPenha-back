import type { Request, Response, NextFunction } from 'express';
import { verifyFirebaseIdToken } from '../config/firebase';
import { prisma } from '../lib/prisma';
import { unauthorized } from '../lib/httpErrors';
import { logger } from '../lib/logger';

function parseBearerToken(req: Request): string | null {
  const raw = req.header('authorization') ?? req.header('Authorization');
  if (!raw || !raw.startsWith('Bearer ')) return null;
  const token = raw.slice(7).trim();
  return token.length > 0 ? token : null;
}

/** Verifies Bearer ID token and attaches `req.firebaseAuth`. Does not load Prisma user. */
export async function authenticateFirebaseToken(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = parseBearerToken(req);
    if (!token) {
      logger.warn({ path: req.path, reason: 'missing_token' }, 'auth rejected');
      next(unauthorized('Missing Authorization Bearer token'));
      return;
    }
    const decoded = await verifyFirebaseIdToken(token);
    req.firebaseAuth = {
      uid: decoded.uid,
      email: typeof decoded.email === 'string' ? decoded.email : undefined,
    };
    next();
  } catch {
    logger.warn({ path: req.path, reason: 'invalid_token' }, 'auth rejected');
    next(unauthorized('Invalid or expired token'));
  }
}

/** Requires a valid Firebase token and a matching row in `users`. Sets `req.appUser`. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = parseBearerToken(req);
    if (!token) {
      logger.warn({ path: req.path, reason: 'missing_token' }, 'auth rejected');
      next(unauthorized('Missing Authorization Bearer token'));
      return;
    }
    const decoded = await verifyFirebaseIdToken(token);
    const user = await prisma.user.findUnique({
      where: { firebaseUid: decoded.uid },
    });
    if (!user) {
      logger.warn(
        { path: req.path, firebaseUid: decoded.uid, reason: 'user_not_registered' },
        'auth rejected'
      );
      next(unauthorized('User not registered; complete signup first'));
      return;
    }
    req.firebaseAuth = { uid: decoded.uid, email: decoded.email };
    req.appUser = user;
    next();
  } catch {
    logger.warn({ path: req.path, reason: 'invalid_token' }, 'auth rejected');
    next(unauthorized('Invalid or expired token'));
  }
}

/** If Bearer is present and valid, loads `req.appUser` when registered; otherwise continues without user. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = parseBearerToken(req);
    if (!token) {
      next();
      return;
    }
    const decoded = await verifyFirebaseIdToken(token);
    req.firebaseAuth = { uid: decoded.uid, email: decoded.email };
    const user = await prisma.user.findUnique({
      where: { firebaseUid: decoded.uid },
    });
    if (user) req.appUser = user;
    next();
  } catch {
    logger.warn({ path: req.path, reason: 'invalid_token' }, 'auth rejected');
    next(unauthorized('Invalid or expired token'));
  }
}

/**
 * For anonymous-only routes (e.g. POST /post/:id/view).
 * Rejects registered users (400) so they use the logged-in flow instead.
 * Invalid Bearer → 401; no Bearer → continues.
 */
export async function rejectRegisteredAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = parseBearerToken(req);
    if (!token) {
      next();
      return;
    }
    const decoded = await verifyFirebaseIdToken(token);
    const user = await prisma.user.findUnique({
      where: { firebaseUid: decoded.uid },
    });
    if (user) {
      next(
        badRequest('Logged-in users must use POST /user/read/:postId to register a view')
      );
      return;
    }
    next();
  } catch {
    logger.warn({ path: req.path, reason: 'invalid_token' }, 'auth rejected');
    next(unauthorized('Invalid or expired token'));
  }
}
