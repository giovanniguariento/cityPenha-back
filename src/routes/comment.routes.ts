import { Router } from 'express';
import { CommentController } from '../controllers/comment.controller';
import { commentService, wordpressService } from '../services';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
const commentController = new CommentController(commentService, wordpressService);

router.get('/:commentId/replies', optionalAuth, asyncHandler(commentController.listReplies));
router.post('/:commentId/like', requireAuth, asyncHandler(commentController.toggleLike));
router.delete('/:commentId', requireAuth, asyncHandler(commentController.delete));

export default router;
