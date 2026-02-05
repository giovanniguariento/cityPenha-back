import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { wordpressService, userService } from '../services';

const router = Router();
const userController = new UserController(wordpressService, userService);

router.post('/signup', userController.create);
router.post('/read/:postId', userController.recordRead);
router.get('/:id', userController.getInfo);

export default router;
