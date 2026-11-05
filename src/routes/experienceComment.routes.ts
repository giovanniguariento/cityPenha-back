import { Router } from 'express';
import { ExperienceCommentController } from '../controllers/experienceComment.controller';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { writeRateLimit } from '../middleware/writeRateLimit';

const router = Router();
const c = new ExperienceCommentController();

router.get('/:commentId/replies', optionalAuth, asyncHandler(c.listReplies));
router.post(
  '/:commentId/like',
  requireAuth,
  writeRateLimit,
  asyncHandler(c.toggleLike)
);
router.delete(
  '/:commentId',
  requireAuth,
  writeRateLimit,
  asyncHandler(c.delete)
);

export default router;
