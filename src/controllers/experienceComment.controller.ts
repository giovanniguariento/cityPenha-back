import type { Request, Response } from 'express';
import { experienceCommentService } from '../services/experienceComment.service';
import { gamification } from '../services';
import { sendJsonSuccess } from '../lib/apiResponse';
import { unauthorized, validationError } from '../lib/httpErrors';

export class ExperienceCommentController {
  listReplies = async (req: Request, res: Response): Promise<void> => {
    const { commentId } = req.params;
    if (!commentId) throw validationError('Missing commentId');

    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const { comments, nextCursor } = await experienceCommentService.listReplies(
      commentId,
      { cursor, limit },
      req.appUser?.id
    );
    sendJsonSuccess(res, comments, { meta: { nextCursor } });
  };

  toggleLike = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) throw unauthorized('Unauthorized');
    const { commentId } = req.params;
    if (!commentId) throw validationError('Missing commentId');

    const result = await experienceCommentService.toggleLike(user.id, commentId);
    sendJsonSuccess(res, result);
  };

  delete = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) throw unauthorized('Unauthorized');
    const { commentId } = req.params;
    if (!commentId) throw validationError('Missing commentId');

    await experienceCommentService.delete(user.id, commentId);
    await gamification.notify('experience.comment.removed', {
      userId: user.id,
      experienceCommentId: commentId,
    });
    sendJsonSuccess(res, { deleted: true });
  };
}
