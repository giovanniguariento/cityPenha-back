import { Router } from 'express';
import { PostController } from '../controllers/post.controller';
import { wordpressService } from '../services';

const router = Router();
const postController = new PostController(wordpressService);

router.get('/:slug', postController.get);

export default router;
