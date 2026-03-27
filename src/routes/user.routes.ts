import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { wordpressService, userService, postFolderService } from '../services';

const router = Router();
const userController = new UserController(wordpressService, userService, postFolderService);

router.post('/signup', userController.create);
router.post('/read/:postId', userController.recordRead);

router.get('/:id/folders', userController.listFolders);
router.get('/:id/folders/:folderId/posts', userController.listPostsInFolder);
router.post('/:id/folders', userController.createFolder);
router.delete('/:id/folders/:folderId', userController.deleteFolder);
router.post('/:id/folders/:folderId/posts/:wordpressPostId', userController.addPostToFolder);
router.delete('/:id/folders/:folderId/posts/:wordpressPostId', userController.removePostFromFolder);

router.get('/:id/frequency', userController.getFrequency);
router.get('/:id', userController.getInfo);

export default router;
