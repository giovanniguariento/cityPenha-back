import { Router } from 'express';
import { ExperienceController } from '../controllers/experience.controller';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { requireCanCreateExperiences } from '../middleware/requireCanCreateExperiences';
import { uploadExperienceCover } from '../middleware/uploadExperienceCover';
import { asyncHandler } from '../middleware/asyncHandler';
import { writeRateLimit } from '../middleware/writeRateLimit';

const router = Router();
const c = new ExperienceController();

router.get('/', optionalAuth, asyncHandler(c.list));

router.get(
  '/mine',
  requireAuth,
  requireCanCreateExperiences,
  asyncHandler(c.listMine)
);
router.get(
  '/mine/:id',
  requireAuth,
  requireCanCreateExperiences,
  asyncHandler(c.getMine)
);

router.post(
  '/',
  requireAuth,
  requireCanCreateExperiences,
  writeRateLimit,
  uploadExperienceCover,
  asyncHandler(c.create)
);

router.patch(
  '/:id',
  requireAuth,
  writeRateLimit,
  uploadExperienceCover,
  asyncHandler(c.update)
);

router.delete(
  '/:id',
  requireAuth,
  writeRateLimit,
  asyncHandler(c.delete)
);

router.post('/:id/like', requireAuth, writeRateLimit, asyncHandler(c.toggleLike));
router.post('/:id/share', requireAuth, writeRateLimit, asyncHandler(c.share));

router.get('/:id/comments', optionalAuth, asyncHandler(c.listComments));
router.post(
  '/:id/comments',
  requireAuth,
  writeRateLimit,
  asyncHandler(c.createComment)
);

router.get('/:slug', optionalAuth, asyncHandler(c.getBySlug));

export default router;
