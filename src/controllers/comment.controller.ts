import type { Request, Response } from 'express';
import type { CommentService } from '../services/comment.service';
import type { WordpressService } from '../services/wordpress.service';
import { gamification } from '../services';
import { sendJsonSuccess } from '../lib/apiResponse';
import { badRequest, unauthorized, validationError } from '../lib/httpErrors';
import { verifyWordpressPostExists } from '../helpers/post.helper';

const MAX_CONTENT_LENGTH = 2000;

export class CommentController {
  constructor(
    private readonly commentService: CommentService,
    private readonly wordpressService: WordpressService
  ) {}

  /** GET /post/:wordpressPostId/comments?cursor=&limit= */
  list = async (req: Request, res: Response): Promise<void> => {
    const wordpressPostId = Number(req.params.wordpressPostId);
    if (!Number.isFinite(wordpressPostId)) throw badRequest('Invalid post id');

    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const viewerId = req.appUser?.id;
    const { comments, nextCursor } = await this.commentService.listTopLevel(
      wordpressPostId,
      { cursor, limit },
      viewerId
    );

    sendJsonSuccess(res, comments, { meta: { nextCursor } });
  };

  /** GET /comment/:commentId/replies?cursor=&limit= */
  listReplies = async (req: Request, res: Response): Promise<void> => {
    const { commentId } = req.params;

    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const viewerId = req.appUser?.id;
    const { comments, nextCursor } = await this.commentService.listReplies(
      commentId,
      { cursor, limit },
      viewerId
    );

    sendJsonSuccess(res, comments, { meta: { nextCursor } });
  };

  /** POST /post/:wordpressPostId/comments */
  create = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) throw unauthorized('Unauthorized');

    const wordpressPostId = Number(req.params.wordpressPostId);
    if (!Number.isFinite(wordpressPostId)) throw badRequest('Invalid post id');

    const content: unknown = req.body?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw validationError('content is required');
    }
    if (content.trim().length > MAX_CONTENT_LENGTH) {
      throw validationError(`content must not exceed ${MAX_CONTENT_LENGTH} characters`);
    }

    const parentId: unknown = req.body?.parentId;
    const resolvedParentId = typeof parentId === 'string' && parentId.trim() ? parentId.trim() : undefined;

    const exists = await verifyWordpressPostExists(this.wordpressService, wordpressPostId);
    if (!exists) {
      const { notFound } = await import('../lib/httpErrors');
      throw notFound('Post not found');
    }

    const comment = await this.commentService.create(
      user.id,
      wordpressPostId,
      content,
      resolvedParentId
    );

    const snapshot = await gamification.notify('comment.added', {
      userId: user.id,
      wordpressPostId,
      commentId: comment.id,
    });

    sendJsonSuccess(
      res,
      {
        comment,
        missions: snapshot.missions,
        badges: snapshot.badges,
        level: snapshot.level,
        user: snapshot.user,
        completedMissionsCount: snapshot.completedMissionsCount,
        rewards: snapshot.rewards,
      },
      { status: 201 }
    );
  };

  /** POST /comment/:commentId/like */
  toggleLike = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) throw unauthorized('Unauthorized');

    const { commentId } = req.params;
    const { liked, likeCount } = await this.commentService.toggleLike(user.id, commentId);

    sendJsonSuccess(res, { liked, likeCount });
  };

  /** DELETE /comment/:commentId */
  delete = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) throw unauthorized('Unauthorized');

    const { commentId } = req.params;
    await this.commentService.delete(user.id, commentId);

    sendJsonSuccess(res, { id: commentId });
  };
}
