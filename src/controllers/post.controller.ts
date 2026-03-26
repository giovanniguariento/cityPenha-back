import { Request, Response, NextFunction } from 'express';
import { ETypePost, type IPost } from '../models/post.interface';
import { WordpressService } from '../services/wordpress.service';
import { gamification } from '../services';
import type { PostFolderService } from '../services/postFolder.service';
import { toPostDetail, verifyWordpressPostExists } from '../helpers/post.helper';
import type { PostDetailResponse } from '../types';

export class PostController {
  constructor(
    private readonly wordpressService: WordpressService,
    private readonly postFolderService: PostFolderService
  ) {}

  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const slug = req.params.slug as string;
      const searchQuery = slug.replaceAll('-', ' ').slice(0, 60);
      const searchResults = await this.wordpressService.getTypePostBySearch(searchQuery);
      const found = searchResults.find((p) => p._embedded.self[0].slug === slug);

      if (!found) {
        res.status(404).json({ success: false, message: 'Post not found' });
        return;
      }

      const post: IPost =
        found.subtype === ETypePost.POST
          ? await this.wordpressService.getPost(found.id)
          : await this.wordpressService.getAd(found.id);

      const [categories, tags, likesCount] = await Promise.all([
        this.wordpressService.getCategoriesById(post.categories),
        this.wordpressService.getTagsById(post.tags),
        this.postFolderService.countLikesForPost(post.id),
      ]);

      const base = toPostDetail(post, categories, tags);
      const userId = (req.query.userId as string) || req.header('x-user-id') || undefined;

      let payload: PostDetailResponse = { ...base, likesCount };

      if (userId) {
        const [liked, savedFolderIds] = await Promise.all([
          this.postFolderService.isPostLikedByUser(userId, post.id),
          this.postFolderService.getAllFolderIdsContainingPost(userId, post.id),
        ]);
        payload = { ...payload, liked, savedFolderIds };
      }

      res.status(200).json(payload);
    } catch (error) {
      next(error);
    }
  };

  /** POST /post/:wordpressPostId/like — body `{ userId }` alterna curtida na pasta fixa `curtidas`. */
  toggleLike = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const wordpressPostId = Number(req.params.wordpressPostId);
      const { userId } = req.body as { userId?: string };
      if (!userId || !Number.isFinite(wordpressPostId)) {
        res.status(400).json({ success: false, message: 'Missing userId or invalid post id' });
        return;
      }

      const exists = await verifyWordpressPostExists(this.wordpressService, wordpressPostId);
      if (!exists) {
        res.status(404).json({ success: false, message: 'Post not found' });
        return;
      }

      const { liked } = await this.postFolderService.toggleLike(userId, wordpressPostId);
      const likesCount = await this.postFolderService.countLikesForPost(wordpressPostId);

      const likeMission = await gamification.syncLikeMissionState(userId);
      const missions = await gamification.getMissionsWithUserProgress(userId);
      const level = await gamification.getUserLevel(userId);
      const base = { liked, likesCount, missions, level };
      if ('user' in likeMission && likeMission.user) {
        res.status(200).json({
          success: true,
          data: {
            ...base,
            user: likeMission.user,
            completedMissionsCount: likeMission.completedMissionsCount,
          },
        });
      } else {
        res.status(200).json({ success: true, data: base });
      }
    } catch (error) {
      next(error);
    }
  };
}
