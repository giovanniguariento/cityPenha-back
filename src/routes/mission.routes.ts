import { Router } from 'express';
import { MissionController } from '../controllers/mission.controller';
import { optionalAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
const missionController = new MissionController();

router.get('/', optionalAuth, asyncHandler(missionController.getAll));

export default router;
