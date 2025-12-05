import { Router } from 'express';
import { PostController } from '../controllers/post.controller';
import { WordpressService } from '../services/wordpress.service'

const router = Router();
const postController = new PostController(new WordpressService());

// Definition of routes
router.get('/:id', postController.get);

export default router;
