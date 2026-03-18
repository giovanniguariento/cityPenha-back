import { Router } from 'express';
import { MissionController } from '../controllers/mission.controller';

const router = Router();
const missionController = new MissionController();

router.get('/', missionController.getAll);

export default router;
