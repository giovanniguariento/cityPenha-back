import { Router } from 'express';
import { PostController } from '../controllers/post.controller';
import { MyPostsController } from '../controllers/myPosts.controller';
import { CommentController } from '../controllers/comment.controller';
import { wordpressService, postFolderService, commentService } from '../services';
import { optionalAuth, requireAuth, rejectRegisteredAuth } from '../middleware/auth';
import { postViewRateLimit } from '../middleware/viewRateLimit';
import { writeRateLimit } from '../middleware/writeRateLimit';
import { shortPostRateLimit } from '../middleware/shortPostRateLimit';
import { uploadShortVideo } from '../middleware/uploadShortVideo';
import { requireCanCreatePosts } from '../middleware/requireCanCreatePosts';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
const postController = new PostController(wordpressService, postFolderService);
const myPostsController = new MyPostsController(wordpressService);
const commentController = new CommentController(commentService, wordpressService);

router.post(
  '/create',
  requireAuth,
  requireCanCreatePosts,
  shortPostRateLimit,
  uploadShortVideo,
  asyncHandler(postController.create)
);

router.get(
  '/mine',
  requireAuth,
  requireCanCreatePosts,
  asyncHandler(myPostsController.list)
);
router.get(
  '/mine/:id',
  requireAuth,
  requireCanCreatePosts,
  asyncHandler(myPostsController.getOne)
);
router.patch(
  '/mine/:id',
  requireAuth,
  requireCanCreatePosts,
  writeRateLimit,
  asyncHandler(myPostsController.update)
);
router.delete(
  '/mine/:id',
  requireAuth,
  requireCanCreatePosts,
  writeRateLimit,
  asyncHandler(myPostsController.remove)
);

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
