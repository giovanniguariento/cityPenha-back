/**
 * Endpoints CRUD para gerenciar Mission/Badge/Level em runtime.
 * Cada handler valida o body via Zod e converte erros em `VALIDATION_ERROR` 400.
 */
import type { Request, Response } from 'express';
import type { ZodError, ZodType } from 'zod';
import { sendJsonSuccess } from '../lib/apiResponse';
import { badRequest, notFound, validationError } from '../lib/httpErrors';
import { adminGamificationService } from '../services/gamification/admin/service';
import { gamification } from '../services';
import {
  badgeCreateSchema,
  badgeUpdateSchema,
  levelCreateSchema,
  levelUpdateSchema,
  missionCreateSchema,
  missionUpdateSchema,
  previewBodySchema,
} from '../services/gamification/admin/schemas';

function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const err = result.error as ZodError;
    throw validationError('Invalid payload', { issues: err.issues });
  }
  return result.data;
}

export class AdminController {
  // ─── Métricas (introspecção) ──────────────────────────────────────────────
  listMetrics = async (_req: Request, res: Response): Promise<void> => {
    sendJsonSuccess(res, adminGamificationService.listMetrics());
  };

  // ─── Missões ──────────────────────────────────────────────────────────────
  listMissions = async (_req: Request, res: Response): Promise<void> => {
    const missions = await adminGamificationService.listMissions();
    sendJsonSuccess(res, missions);
  };

  getMission = async (req: Request, res: Response): Promise<void> => {
    const mission = await adminGamificationService.getMission(req.params.id);
    if (!mission) throw notFound('Mission not found');
    sendJsonSuccess(res, mission);
  };

  createMission = async (req: Request, res: Response): Promise<void> => {
    const input = parseBody(missionCreateSchema, req.body);
    try {
      const mission = await adminGamificationService.createMission(input);
      sendJsonSuccess(res, mission, { status: 201 });
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : 'Failed to create mission');
    }
  };

  updateMission = async (req: Request, res: Response): Promise<void> => {
    const input = parseBody(missionUpdateSchema, req.body);
    try {
      const mission = await adminGamificationService.updateMission(req.params.id, input);
      sendJsonSuccess(res, mission);
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : 'Failed to update mission');
    }
  };

  deleteMission = async (req: Request, res: Response): Promise<void> => {
    try {
      const deleted = await adminGamificationService.deleteMission(req.params.id);
      sendJsonSuccess(res, { id: deleted.id });
    } catch (e) {
      throw notFound(e instanceof Error ? e.message : 'Mission not found');
    }
  };

  previewMission = async (req: Request, res: Response): Promise<void> => {
    const { userId } = parseBody(previewBodySchema, req.body);
    const result = await adminGamificationService.previewMission(req.params.id, userId);
    if (!result) throw notFound('Mission not found');
    sendJsonSuccess(res, result);
  };

  // ─── Insígnias ────────────────────────────────────────────────────────────
  listBadges = async (_req: Request, res: Response): Promise<void> => {
    sendJsonSuccess(res, await adminGamificationService.listBadges());
  };

  getBadge = async (req: Request, res: Response): Promise<void> => {
    const badge = await adminGamificationService.getBadge(req.params.id);
    if (!badge) throw notFound('Badge not found');
    sendJsonSuccess(res, badge);
  };

  createBadge = async (req: Request, res: Response): Promise<void> => {
    const input = parseBody(badgeCreateSchema, req.body);
    try {
      const badge = await adminGamificationService.createBadge(input);
      sendJsonSuccess(res, badge, { status: 201 });
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : 'Failed to create badge');
    }
  };

  updateBadge = async (req: Request, res: Response): Promise<void> => {
    const input = parseBody(badgeUpdateSchema, req.body);
    try {
      const badge = await adminGamificationService.updateBadge(req.params.id, input);
      sendJsonSuccess(res, badge);
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : 'Failed to update badge');
    }
  };

  deleteBadge = async (req: Request, res: Response): Promise<void> => {
    try {
      const deleted = await adminGamificationService.deleteBadge(req.params.id);
      sendJsonSuccess(res, { id: deleted.id });
    } catch (e) {
      throw notFound(e instanceof Error ? e.message : 'Badge not found');
    }
  };

  // ─── Levels ───────────────────────────────────────────────────────────────
  listLevels = async (_req: Request, res: Response): Promise<void> => {
    sendJsonSuccess(res, await adminGamificationService.listLevels());
  };

  getLevel = async (req: Request, res: Response): Promise<void> => {
    const level = await adminGamificationService.getLevel(req.params.id);
    if (!level) throw notFound('Level not found');
    sendJsonSuccess(res, level);
  };

  createLevel = async (req: Request, res: Response): Promise<void> => {
    const input = parseBody(levelCreateSchema, req.body);
    try {
      const level = await adminGamificationService.createLevel(input);
      sendJsonSuccess(res, level, { status: 201 });
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : 'Failed to create level');
    }
  };

  updateLevel = async (req: Request, res: Response): Promise<void> => {
    const input = parseBody(levelUpdateSchema, req.body);
    try {
      const level = await adminGamificationService.updateLevel(req.params.id, input);
      sendJsonSuccess(res, level);
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : 'Failed to update level');
    }
  };

  deleteLevel = async (req: Request, res: Response): Promise<void> => {
    try {
      const deleted = await adminGamificationService.deleteLevel(req.params.id);
      sendJsonSuccess(res, { id: deleted.id });
    } catch (e) {
      throw notFound(e instanceof Error ? e.message : 'Level not found');
    }
  };

  // ─── Operações de manutenção ──────────────────────────────────────────────
  recomputeUser = async (req: Request, res: Response): Promise<void> => {
    const { userId } = req.params;
    if (!userId) throw validationError('Missing userId');
    const snapshot = await gamification.recompute(userId);
    sendJsonSuccess(res, snapshot);
  };

  /**
   * GET /admin/users/:userId/ledger — auditoria de grants/revokes.
   * Query params: `limit` (1-200, default 50), `cursor` (id da última entrada anterior).
   */
  getUserLedger = async (req: Request, res: Response): Promise<void> => {
    const { userId } = req.params;
    if (!userId) throw validationError('Missing userId');
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    if (limit !== undefined && !Number.isFinite(limit)) {
      throw validationError('Invalid limit');
    }
    const entries = await adminGamificationService.listLedgerForUser(userId, { limit, cursor });
    sendJsonSuccess(res, entries, {
      meta: {
        nextCursor: entries.length > 0 ? entries[entries.length - 1].id : null,
        count: entries.length,
      },
    });
  };
}
