/**
 * User routes use Firebase Bearer auth only. Legacy `/user/:id/...` paths were removed (breaking change).
 */
import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { wordpressService, userService, postFolderService } from '../services';
import { authenticateFirebaseToken, requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { uploadAvatar } from '../middleware/uploadAvatar';
import { avatarUploadRateLimit } from '../middleware/avatarUploadRateLimit';
import { signupRateLimit, writeRateLimit } from '../middleware/writeRateLimit';

const router = Router();
const userController = new UserController(wordpressService, userService, postFolderService);

router.post(
  '/signup',
  signupRateLimit,
  authenticateFirebaseToken,
  asyncHandler(userController.create)
);
router.post('/read/:postId', requireAuth, writeRateLimit, asyncHandler(userController.recordRead));

router.get('/me', requireAuth, asyncHandler(userController.getInfo));
router.patch('/me', requireAuth, writeRateLimit, asyncHandler(userController.updateProfile));
router.post(
  '/me/avatar',
  requireAuth,
  avatarUploadRateLimit,
  uploadAvatar,
  asyncHandler(userController.updateAvatar)
);
router.get('/me/badges', requireAuth, asyncHandler(userController.listBadges));
router.get('/me/frequency', requireAuth, asyncHandler(userController.getFrequency));
router.get('/me/folders', requireAuth, asyncHandler(userController.listFolders));
router.get('/me/folders/:folderId/posts', requireAuth, asyncHandler(userController.listPostsInFolder));
router.post('/me/folders', requireAuth, writeRateLimit, asyncHandler(userController.createFolder));
router.delete(
  '/me/folders/:folderId',
  requireAuth,
  writeRateLimit,
  asyncHandler(userController.deleteFolder)
);
router.post(
  '/me/folders/:folderId/posts/:wordpressPostId',
  requireAuth,
  writeRateLimit,
  asyncHandler(userController.addPostToFolder)
);
router.delete(
  '/me/folders/:folderId/posts/:wordpressPostId',
  requireAuth,
  writeRateLimit,
  asyncHandler(userController.removePostFromFolder)
);

export default router;
