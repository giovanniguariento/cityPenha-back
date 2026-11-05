import type { Request, Response } from 'express';
import { experienceService } from '../services/experience.service';
import type {
  CreateExperienceInput,
  ExperienceStatus,
  UpdateExperienceInput,
} from '../services/experience.service';
import { experienceCommentService } from '../services/experienceComment.service';
import { wordpressService, gamification } from '../services';
import { sendJsonSuccess } from '../lib/apiResponse';
import {
  badRequest,
  unauthorized,
  validationError,
  notFound,
  badGateway,
} from '../lib/httpErrors';
import { resolveShortPostWordpressAuth } from '../helpers/shortPost.helper';
import { parseTagsInput } from '../helpers/experienceFormat.helper';
import { isAdminUid } from '../middleware/adminAuth';
import { logger } from '../lib/logger';

const MAX_CONTENT_LENGTH = 2000;

function parseDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !value.trim()) {
    throw validationError(`${field} is required`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw validationError(`${field} must be a valid ISO date`);
  }
  return d;
}

function parseOptionalDate(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return parseDate(value, field);
}

function parseBool(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}

function parseIntField(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw validationError(`${field} must be a non-negative number`);
  }
  return Math.floor(n);
}

function parseStatus(value: unknown): ExperienceStatus | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'draft' || value === 'published' || value === 'archived') return value;
  throw validationError('status must be draft, published or archived');
}

async function resolveCoverUrl(req: Request): Promise<string | undefined> {
  const body = req.body as Record<string, unknown> | undefined;
  const coverFromBody =
    typeof body?.coverUrl === 'string' && body.coverUrl.trim()
      ? body.coverUrl.trim()
      : undefined;

  const file = req.file;
  if (!file) return coverFromBody;

  const user = req.appUser;
  if (!user) throw unauthorized('Unauthorized');

  const authResolved = resolveShortPostWordpressAuth(user);
  if (!authResolved) {
    throw badRequest(
      'WordPress credentials unavailable. Configure ENV_API_WORDPRESS_ADMIN_USER/PASSWORD for cover uploads.'
    );
  }

  const ext =
    file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';

  try {
    const media = await wordpressService.uploadMedia({
      buffer: file.buffer,
      filename: `experience-cover-${Date.now()}.${ext}`,
      mimeType: file.mimetype,
      auth: authResolved.auth,
    });
    return media.sourceUrl;
  } catch (err) {
    logger.error({ err }, 'Failed to upload experience cover');
    throw badGateway('Failed to upload cover image');
  }
}

function bodyCreateInput(
  body: Record<string, unknown>,
  coverUrl: string
): CreateExperienceInput {
  const title = typeof body.title === 'string' ? body.title : '';
  const description = typeof body.description === 'string' ? body.description : '';
  const venue = typeof body.venue === 'string' ? body.venue : '';
  const address =
    typeof body.address === 'string'
      ? body.address
      : body.address === null
        ? null
        : undefined;
  const conditionLabel =
    typeof body.conditionLabel === 'string'
      ? body.conditionLabel
      : body.conditionLabel === null
        ? null
        : undefined;

  return {
    title,
    description,
    coverUrl,
    venue,
    address: address ?? null,
    conditionLabel: conditionLabel ?? null,
    startsAt: parseDate(body.startsAt, 'startsAt'),
    endsAt: parseOptionalDate(body.endsAt, 'endsAt') ?? null,
    xpReward: parseIntField(body.xpReward, 'xpReward') ?? 0,
    featured: parseBool(body.featured) === true,
    isAd: parseBool(body.isAd) === true,
    tags: body.tags !== undefined ? parseTagsInput(body.tags) : [],
    status: parseStatus(body.status) ?? 'published',
  };
}

export class ExperienceController {
  list = async (req: Request, res: Response): Promise<void> => {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const featuredOnly =
      req.query.featured === '1' ||
      req.query.featured === 'true';

    if (featuredOnly) {
      const items = await experienceService.listFeatured(
        Number.isFinite(limit) ? limit : 10
      );
      sendJsonSuccess(res, items);
      return;
    }

    const { items, nextCursor } = await experienceService.listPublished({
      q,
      cursor,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    sendJsonSuccess(res, items, { meta: { nextCursor } });
  };

  getBySlug = async (req: Request, res: Response): Promise<void> => {
    const { slug } = req.params;
    if (!slug) throw validationError('Missing slug');
    const detail = await experienceService.getBySlug(slug, req.appUser?.id);
    if (!detail) throw notFound('Experience not found');
    sendJsonSuccess(res, detail);
  };

  listMine = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) throw unauthorized('Unauthorized');
    const items = await experienceService.listMine(user.id);
    sendJsonSuccess(res, items);
  };

  getMine = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) throw unauthorized('Unauthorized');
    const { id } = req.params;
    if (!id) throw validationError('Missing id');
    const item = await experienceService.getMineById(user.id, id);
    if (!item) throw notFound('Experience not found');
    sendJsonSuccess(res, item);
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) throw unauthorized('Unauthorized');

    const coverUrl = await resolveCoverUrl(req);
    if (!coverUrl) throw validationError('cover file or coverUrl is required');

    const body = (req.body ?? {}) as Record<string, unknown>;
    const created = await experienceService.create(user.id, bodyCreateInput(body, coverUrl));
    sendJsonSuccess(res, created, { status: 201 });
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) throw unauthorized('Unauthorized');
    const { id } = req.params;
    if (!id) throw validationError('Missing id');

    const coverUrl = await resolveCoverUrl(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const input: UpdateExperienceInput = {};

    if (typeof body.title === 'string') input.title = body.title;
    if (typeof body.description === 'string') input.description = body.description;
    if (coverUrl) input.coverUrl = coverUrl;
    else if (typeof body.coverUrl === 'string') input.coverUrl = body.coverUrl;
    if (typeof body.venue === 'string') input.venue = body.venue;
    if (body.address !== undefined) {
      input.address = typeof body.address === 'string' ? body.address : null;
    }
    if (body.conditionLabel !== undefined) {
      input.conditionLabel =
        typeof body.conditionLabel === 'string' ? body.conditionLabel : null;
    }
    if (body.startsAt !== undefined) input.startsAt = parseDate(body.startsAt, 'startsAt');
    if (body.endsAt !== undefined) input.endsAt = parseOptionalDate(body.endsAt, 'endsAt') ?? null;
    if (body.xpReward !== undefined) input.xpReward = parseIntField(body.xpReward, 'xpReward');
    if (body.featured !== undefined) input.featured = parseBool(body.featured);
    if (body.isAd !== undefined) input.isAd = parseBool(body.isAd);
    if (body.tags !== undefined) input.tags = parseTagsInput(body.tags);
    if (body.status !== undefined) input.status = parseStatus(body.status);

    const updated = await experienceService.update(user.id, id, input, {
      isAdmin: isAdminUid(req.firebaseAuth?.uid),
    });
    sendJsonSuccess(res, updated);
  };

  delete = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) throw unauthorized('Unauthorized');
    const { id } = req.params;
    if (!id) throw validationError('Missing id');
    await experienceService.delete(user.id, id, {
      isAdmin: isAdminUid(req.firebaseAuth?.uid),
    });
    sendJsonSuccess(res, { deleted: true });
  };

  toggleLike = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) throw unauthorized('Unauthorized');
    const { id } = req.params;
    if (!id) throw validationError('Missing id');

    const result = await experienceService.toggleLike(user.id, id);
    const snapshot = await gamification.notify(
      result.liked ? 'experience.like.added' : 'experience.like.removed',
      { userId: user.id, experienceId: id }
    );

    sendJsonSuccess(res, {
      liked: result.liked,
      likeCount: result.likeCount,
      missions: snapshot.missions,
      badges: snapshot.badges,
      level: snapshot.level,
      user: snapshot.user,
      completedMissionsCount: snapshot.completedMissionsCount,
      rewards: snapshot.rewards,
    });
  };

  share = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) throw unauthorized('Unauthorized');
    const { id } = req.params;
    if (!id) throw validationError('Missing id');

    const result = await experienceService.registerShare(user.id, id);
    const snapshot = await gamification.notify('experience.share.added', {
      userId: user.id,
      experienceId: id,
    });

    sendJsonSuccess(res, {
      shared: result.shared,
      shareCount: result.shareCount,
      alreadyShared: result.alreadyShared,
      missions: snapshot.missions,
      badges: snapshot.badges,
      level: snapshot.level,
      user: snapshot.user,
      completedMissionsCount: snapshot.completedMissionsCount,
      rewards: snapshot.rewards,
    });
  };

  listComments = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    if (!id) throw validationError('Missing id');
    const experience = await experienceService.getById(id);
    if (!experience || experience.status !== 'published') {
      throw notFound('Experience not found');
    }

    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const { comments, nextCursor } = await experienceCommentService.listTopLevel(
      id,
      { cursor, limit },
      req.appUser?.id
    );
    sendJsonSuccess(res, comments, { meta: { nextCursor } });
  };

  createComment = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) throw unauthorized('Unauthorized');
    const { id } = req.params;
    if (!id) throw validationError('Missing id');

    const content: unknown = req.body?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw validationError('content is required');
    }
    if (content.trim().length > MAX_CONTENT_LENGTH) {
      throw validationError(`content must not exceed ${MAX_CONTENT_LENGTH} characters`);
    }

    const parentId: unknown = req.body?.parentId;
    const resolvedParentId =
      typeof parentId === 'string' && parentId.trim() ? parentId.trim() : undefined;

    const comment = await experienceCommentService.create(
      user.id,
      id,
      content,
      resolvedParentId
    );

    const snapshot = await gamification.notify('experience.comment.added', {
      userId: user.id,
      experienceId: id,
      experienceCommentId: comment.id,
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
}
