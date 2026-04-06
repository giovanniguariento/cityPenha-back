import { Router } from 'express';
import { PostController } from '../controllers/post.controller';
import { wordpressService, postFolderService } from '../services';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
const postController = new PostController(wordpressService, postFolderService);

router.post('/:wordpressPostId/like', requireAuth, asyncHandler(postController.toggleLike));
router.get('/:slug', optionalAuth, asyncHandler(postController.get));

export default router;
