import { Router } from 'express';
import { DiscoveryController } from '../controllers/discovery.controller';
import { discoveryService } from '../services';
import { optionalAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
const discoveryController = new DiscoveryController(discoveryService);

router.get('/', optionalAuth, asyncHandler(discoveryController.get));

export default router;
