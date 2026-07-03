import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { WordpressService } from '../services/wordpress.service';
import { gamification, postViewService } from '../services';
import type { PostFolderService } from '../services/postFolder.service';
import { fetchPostOrAd, toPostDetail, verifyWordpressPostExists } from '../helpers/post.helper';
import { resolveDefaultAuthorAvatarUrl } from '../helpers/wordpressDefaultAvatar.helper';
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

    const post = await fetchPostOrAd(this.wordpressService, resolved.id, resolved.kind);
    if (!post) {
      throw notFound('Post not found');
    }

    const userId = req.appUser?.id;

    const [categories, tags, likesCount, readRecord, viewsCount, defaultAvatarUrl] =
      await Promise.all([
      this.wordpressService.getCategoriesById(post.categories),
      this.wordpressService.getTagsById(post.tags),
      this.postFolderService.countLikesForPost(post.id),
      userId
        ? prisma.readPost.findUnique({
            where: {
              userId_wordpressPostId: { userId, wordpressPostId: post.id },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
      postViewService.getViewsCount(post.id),
      resolveDefaultAuthorAvatarUrl(),
    ]);

    const base = toPostDetail(post, categories, tags, defaultAvatarUrl);
    let payload: PostDetailResponse = { ...base, likesCount, viewsCount };

    if (userId) {
      const [liked, savedFolderIds] = await Promise.all([
        this.postFolderService.isPostLikedByUser(userId, post.id),
        this.postFolderService.getAllFolderIdsContainingPost(userId, post.id),
      ]);
      payload = { ...payload, liked, savedFolderIds, viewed: Boolean(readRecord) };
    }

    sendJsonSuccess(res, payload);
  };

  /** POST /post/:wordpressPostId/view — somente visitantes anônimos (ver rejectRegisteredAuth). */
  recordView = async (req: Request, res: Response): Promise<void> => {
    const wordpressPostId = Number(req.params.wordpressPostId);
    if (!Number.isFinite(wordpressPostId)) {
      throw badRequest('Invalid post id');
    }

    const { visitorId } = req.body as { visitorId?: string };
    if (!visitorId) {
      throw badRequest('Invalid or missing visitorId (expected UUID v4)');
    }

    const exists = await verifyWordpressPostExists(this.wordpressService, wordpressPostId);
    if (!exists) {
      throw notFound('Post not found');
    }

    const { alreadyViewed } = await postViewService.recordAnonymousView(
      wordpressPostId,
      visitorId
    );
    const viewsCount = await postViewService.getViewsCount(wordpressPostId);

    sendJsonSuccess(res, { wordpressPostId, viewsCount, alreadyViewed });
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
