import { Router } from 'express';
import { HomeController } from '../controllers/home.controller';
import { wordpressService } from '../services';

const router = Router();
const homeController = new HomeController(wordpressService);

router.get('/', homeController.getAll);

export default router;
