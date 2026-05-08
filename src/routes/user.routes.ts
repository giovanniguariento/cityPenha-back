/**
 * User routes use Firebase Bearer auth only. Legacy `/user/:id/...` paths were removed (breaking change).
 */
import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { wordpressService, userService, postFolderService } from '../services';
import { authenticateFirebaseToken, requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
const userController = new UserController(wordpressService, userService, postFolderService);

router.post('/signup', authenticateFirebaseToken, asyncHandler(userController.create));
router.post('/read/:postId', requireAuth, asyncHandler(userController.recordRead));

router.get('/me', requireAuth, asyncHandler(userController.getInfo));
router.patch('/me', requireAuth, asyncHandler(userController.updateProfile));
router.get('/me/badges', requireAuth, asyncHandler(userController.listBadges));
router.get('/me/frequency', requireAuth, asyncHandler(userController.getFrequency));
router.get('/me/folders', requireAuth, asyncHandler(userController.listFolders));
router.get('/me/folders/:folderId/posts', requireAuth, asyncHandler(userController.listPostsInFolder));
router.post('/me/folders', requireAuth, asyncHandler(userController.createFolder));
router.delete('/me/folders/:folderId', requireAuth, asyncHandler(userController.deleteFolder));
router.post(
  '/me/folders/:folderId/posts/:wordpressPostId',
  requireAuth,
  asyncHandler(userController.addPostToFolder)
);
router.delete(
  '/me/folders/:folderId/posts/:wordpressPostId',
  requireAuth,
  asyncHandler(userController.removePostFromFolder)
);

export default router;
