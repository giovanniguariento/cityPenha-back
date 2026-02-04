import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { wordpressService, userService } from '../services';

const router = Router();
const userController = new UserController(wordpressService, userService);

router.post('/signup', userController.create);

export default router;
