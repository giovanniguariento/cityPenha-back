import type { Request, Response, NextFunction } from 'express';
import { verifyFirebaseIdToken } from '../config/firebase';
import { prisma } from '../lib/prisma';
import { unauthorized } from '../lib/httpErrors';

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
    next(unauthorized('Invalid or expired token'));
  }
}

/** Requires a valid Firebase token and a matching row in `users`. Sets `req.appUser`. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = parseBearerToken(req);
    if (!token) {
      next(unauthorized('Missing Authorization Bearer token'));
      return;
    }
    const decoded = await verifyFirebaseIdToken(token);
    const user = await prisma.user.findUnique({
      where: { firebaseUid: decoded.uid },
    });
    if (!user) {
      next(unauthorized('User not registered; complete signup first'));
      return;
    }
    req.firebaseAuth = { uid: decoded.uid, email: decoded.email };
    req.appUser = user;
    next();
  } catch {
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
    next(unauthorized('Invalid or expired token'));
  }
}
