/**
 * Shared service instances so all routes use the same cache and DB connection.
 */
import { WordpressService } from './wordpress.service';
import { UserService } from './user.service';
import { gamificationService } from './gamification.service';

export const wordpressService = new WordpressService();
export const userService = new UserService();
export const gamification = gamificationService;
