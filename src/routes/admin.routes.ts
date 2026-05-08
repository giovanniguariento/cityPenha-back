/**
 * Rotas administrativas para gerenciar gamificação dinâmica.
 * Toda rota exige `requireAuth` (Firebase Bearer + usuário registrado) + `requireAdmin`
 * (UID listado em `ADMIN_FIREBASE_UIDS`).
 */
import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/adminAuth';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
const c = new AdminController();

router.use(requireAuth, requireAdmin);

// Métricas (introspecção do que existe no MetricRegistry)
router.get('/metrics', asyncHandler(c.listMetrics));

// Missões
router.get('/missions', asyncHandler(c.listMissions));
router.post('/missions', asyncHandler(c.createMission));
router.get('/missions/:id', asyncHandler(c.getMission));
router.patch('/missions/:id', asyncHandler(c.updateMission));
router.delete('/missions/:id', asyncHandler(c.deleteMission));
router.post('/missions/:id/preview', asyncHandler(c.previewMission));

// Insígnias
router.get('/badges', asyncHandler(c.listBadges));
router.post('/badges', asyncHandler(c.createBadge));
router.get('/badges/:id', asyncHandler(c.getBadge));
router.patch('/badges/:id', asyncHandler(c.updateBadge));
router.delete('/badges/:id', asyncHandler(c.deleteBadge));

// Levels
router.get('/levels', asyncHandler(c.listLevels));
router.post('/levels', asyncHandler(c.createLevel));
router.get('/levels/:id', asyncHandler(c.getLevel));
router.patch('/levels/:id', asyncHandler(c.updateLevel));
router.delete('/levels/:id', asyncHandler(c.deleteLevel));

// Recomputo manual (após mudar regras / migração)
router.post('/recompute/:userId', asyncHandler(c.recomputeUser));

// Auditoria do reward ledger (analytics / suporte)
router.get('/users/:userId/ledger', asyncHandler(c.getUserLedger));

export default router;
