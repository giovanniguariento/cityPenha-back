import { Router } from 'express';
import { PostController } from '../controllers/post.controller';
import { CommentController } from '../controllers/comment.controller';
import { wordpressService, postFolderService, commentService } from '../services';
import { optionalAuth, requireAuth, rejectRegisteredAuth } from '../middleware/auth';
import { postViewRateLimit } from '../middleware/viewRateLimit';
import { writeRateLimit } from '../middleware/writeRateLimit';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
const postController = new PostController(wordpressService, postFolderService);
const commentController = new CommentController(commentService, wordpressService);

router.post(
  '/:wordpressPostId/like',
  requireAuth,
  writeRateLimit,
  asyncHandler(postController.toggleLike)
);
router.post(
  '/:wordpressPostId/view',
  postViewRateLimit,
  rejectRegisteredAuth,
  asyncHandler(postController.recordView)
);
router.get('/:wordpressPostId/comments', optionalAuth, asyncHandler(commentController.list));
router.post(
  '/:wordpressPostId/comments',
  requireAuth,
  writeRateLimit,
  asyncHandler(commentController.create)
);
router.get('/:slug', optionalAuth, asyncHandler(postController.get));

export default router;
