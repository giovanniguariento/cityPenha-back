import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { WordpressService } from '../services/wordpress.service'
import { UserService } from '../services/user.service';

const router = Router();
const userController = new UserController(new WordpressService(), new UserService());

// Definition of routes
router.post('/signup', userController.create);

export default router;
