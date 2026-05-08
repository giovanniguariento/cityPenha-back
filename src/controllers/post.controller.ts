import type { Request, Response } from 'express';
import type { IPost } from '../models/post.interface';
import { WordpressService } from '../services/wordpress.service';
import { gamification } from '../services';
import type { PostFolderService } from '../services/postFolder.service';
import { toPostDetail, verifyWordpressPostExists } from '../helpers/post.helper';
import type { PostDetailResponse } from '../types';
import { sendJsonSuccess } from '../lib/apiResponse';
import { badRequest, notFound, unauthorized } from '../lib/httpErrors';

export class PostController {
  constructor(
    private readonly wordpressService: WordpressService,
    private readonly postFolderService: PostFolderService
  ) {}

  get = async (req: Request, res: Response): Promise<void> => {
    const slug = req.params.slug as string;
    const resolved = await this.wordpressService.resolvePostBySlug(slug);
    if (!resolved) {
      throw notFound('Post not found');
    }

    const post: IPost =
      resolved.kind === 'post'
        ? await this.wordpressService.getPost(resolved.id)
        : await this.wordpressService.getAd(resolved.id);

    const [categories, tags, likesCount] = await Promise.all([
      this.wordpressService.getCategoriesById(post.categories),
      this.wordpressService.getTagsById(post.tags),
      this.postFolderService.countLikesForPost(post.id),
    ]);

    const base = toPostDetail(post, categories, tags);
    const userId = req.appUser?.id;

    let payload: PostDetailResponse = { ...base, likesCount };

    if (userId) {
      const [liked, savedFolderIds] = await Promise.all([
        this.postFolderService.isPostLikedByUser(userId, post.id),
        this.postFolderService.getAllFolderIdsContainingPost(userId, post.id),
      ]);
      payload = { ...payload, liked, savedFolderIds };
    }

    sendJsonSuccess(res, payload);
  };

  /** POST /post/:wordpressPostId/like — identidade via Bearer (requireAuth). */
  toggleLike = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) {
      throw unauthorized('Unauthorized');
    }
    const userId = user.id;

    const wordpressPostId = Number(req.params.wordpressPostId);
    if (!Number.isFinite(wordpressPostId)) {
      throw badRequest('Invalid post id');
    }

    const exists = await verifyWordpressPostExists(this.wordpressService, wordpressPostId);
    if (!exists) {
      throw notFound('Post not found');
    }

    const { liked } = await this.postFolderService.toggleLike(userId, wordpressPostId);
    const likesCount = await this.postFolderService.countLikesForPost(wordpressPostId);

    const snapshot = await gamification.notify(liked ? 'like.added' : 'like.removed', {
      userId,
      wordpressPostId,
    });

    sendJsonSuccess(res, {
      liked,
      likesCount,
      missions: snapshot.missions,
      badges: snapshot.badges,
      level: snapshot.level,
      user: snapshot.user,
      completedMissionsCount: snapshot.completedMissionsCount,
      rewards: snapshot.rewards,
    });
  };
}
