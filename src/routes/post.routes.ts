import { Router } from 'express';
import { PostController } from '../controllers/post.controller';
import { wordpressService, postFolderService } from '../services';

const router = Router();
const postController = new PostController(wordpressService, postFolderService);

router.post('/:wordpressPostId/like', postController.toggleLike);
router.get('/:slug', postController.get);

export default router;
