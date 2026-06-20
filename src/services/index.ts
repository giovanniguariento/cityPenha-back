/**
 * Shared service instances so all routes use the same cache and DB connection.
 */
import { UserService } from './user.service';
import { gamificationFacade } from './gamification/index';
import { postFolderService } from './postFolder.service';
import { discoveryService } from './discovery.service';

export { wordpressService } from './wordpress.service';
export { publishPressAuthorsService } from './publishPressAuthors.service';
export const userService = new UserService();
export const gamification = gamificationFacade;
export { postFolderService };
export { discoveryService };
export { postViewService } from './postView.service';
export { commentService } from './comment.service';
