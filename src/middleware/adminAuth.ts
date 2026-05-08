/**
 * Restringe rotas administrativas a UIDs Firebase listados em `ADMIN_FIREBASE_UIDS`
 * (separados por vírgula). Usa-se em conjunto com `requireAuth` (já valida o token e popula `req.appUser`).
 *
 * Migrar para uma tabela `User.role` é um próximo passo natural; por ora, allowlist via env evita
 * uma migration adicional e o overhead de gerenciar permissões na app inicial.
 */
import type { NextFunction, Request, Response } from 'express';
import { forbidden, unauthorized } from '../lib/httpErrors';

let cachedUids: Set<string> | null = null;

function getAdminUids(): Set<string> {
  if (cachedUids) return cachedUids;
  const raw = process.env.ADMIN_FIREBASE_UIDS ?? '';
  cachedUids = new Set(
    raw
      .split(',')
      .map((u) => u.trim())
      .filter((u) => u.length > 0)
  );
  return cachedUids;
}

export function isAdminUid(uid: string | undefined | null): boolean {
  if (!uid) return false;
  return getAdminUids().has(uid);
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const uid = req.firebaseAuth?.uid;
  if (!uid) {
    next(unauthorized('Unauthorized'));
    return;
  }
  if (!isAdminUid(uid)) {
    next(forbidden('Admin role required'));
    return;
  }
  next();
}
