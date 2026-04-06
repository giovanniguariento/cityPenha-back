import { Router } from 'express';
import { HomeController } from '../controllers/home.controller';
import { wordpressService } from '../services';
import { optionalAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
const homeController = new HomeController(wordpressService);

router.get('/', optionalAuth, asyncHandler(homeController.getAll));

export default router;
