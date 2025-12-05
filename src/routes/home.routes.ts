import { Router } from 'express';
import { HomeController } from '../controllers/home.controller';
import { WordpressService } from '../services/wordpress.service'

const router = Router();
const homeController = new HomeController(new WordpressService());

// Definition of routes
router.get('/', homeController.getAll);

export default router;
