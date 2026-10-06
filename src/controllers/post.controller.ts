import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { WordpressService } from '../services/wordpress.service';
import { gamification, postViewService } from '../services';
import type { PostFolderService } from '../services/postFolder.service';
import { fetchPostOrAd, toPostDetailWithAppAuthor, verifyWordpressPostExists } from '../helpers/post.helper';
import { resolveDefaultAuthorAvatarUrl } from '../helpers/wordpressDefaultAvatar.helper';
import { isSingleVideoContent } from '../helpers/content.helper';
import {
  plainTextFromHtml,
  sanitizePostArticleHtml,
  sanitizePostDescriptionHtml,
} from '../helpers/sanitizePostDescription.helper';
import { wrapHtmlAsGutenbergBlocks } from '../helpers/gutenbergBlocks.helper';
import {
  escapeHtmlAttr,
  resolveShortPostWordpressAuth,
  truncate,
} from '../helpers/shortPost.helper';
import type { PostDetailResponse } from '../types';
import { sendJsonSuccess } from '../lib/apiResponse';
import {
  badGateway,
  badRequest,
  forbidden,
  notFound,
  unauthorized,
  validationError,
} from '../lib/httpErrors';
import { logger } from '../lib/logger';
import type { WordpressBasicAuth } from '../services/wordpress.service';
import { userAvatarService } from '../services/userAvatar.service';

function firstFormString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return typeof value === 'string' ? value : '';
}

type CreatePostType = 'video' | 'article';

/** Payload from the `meta` file part (preferred) or multipart text fields (fallback). */
type ShortPostMeta = {
  type?: CreatePostType | string;
  descriptionHtml?: string;
  contentHtml?: string;
  descriptionText?: string;
  categoryId?: number | string;
  title?: string;
  /** Optional custom article excerpt (plain text). */
  summary?: string;
};

function parseCreatePostType(raw: unknown): CreatePostType {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value === 'article') return 'article';
  return 'video';
}

function parseShortPostMetaFile(file: Express.Multer.File | undefined): ShortPostMeta | null {
  if (!file?.buffer?.length) return null;
  try {
    const parsed = JSON.parse(file.buffer.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('meta must be a JSON object');
    }
    return parsed as ShortPostMeta;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Invalid meta JSON';
    throw validationError(`Invalid meta JSON: ${message}`);
  }
}

export class PostController {
  constructor(
    private readonly wordpressService: WordpressService,
    private readonly postFolderService: PostFolderService
  ) {}

  /**
   * POST /post/create — multipart:
   * - `meta` JSON (preferred: type, descriptionHtml|contentHtml, descriptionText, categoryId, title, summary)
   * - type=video: required `video`, optional `thumbnail` poster
   * - type=article: TipTap HTML in contentHtml; optional `thumbnail` featured image; optional `summary` excerpt
   * Requires requireAuth + requireCanCreatePosts + uploadShortVideo.
   */
  create = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) {
      throw unauthorized('Unauthorized');
    }
    if (user.wordpressId == null) {
      throw unauthorized('User has no WordPress author account');
    }

    const files = req.files as
      | { [fieldname: string]: Express.Multer.File[] }
      | undefined;
    const file = files?.video?.[0] ?? req.file;
    const thumbFile = files?.thumbnail?.[0];
    const metaFile = files?.meta?.[0];
    const meta = parseShortPostMetaFile(metaFile);

    const body = req.body as {
      type?: string | string[];
      descriptionHtml?: string | string[];
      contentHtml?: string | string[];
      descriptionText?: string | string[];
      title?: string | string[];
      summary?: string | string[];
      categoryId?: string | string[];
    };

    const postType = parseCreatePostType(meta?.type ?? firstFormString(body.type));

    if (postType === 'video' && !file?.buffer?.length) {
      throw validationError('Missing video file');
    }

    const categoryIdRaw = meta?.categoryId ?? firstFormString(body.categoryId);
    const categoryIdNum = Number(categoryIdRaw);
    if (!Number.isFinite(categoryIdNum) || categoryIdNum <= 0) {
      throw validationError('categoryId is required');
    }
    let categoryId = categoryIdNum;

    const resolvedCategories = await this.wordpressService.getCategoriesById([categoryId]);
    if (!resolvedCategories.length) {
      throw validationError('Invalid categoryId');
    }
    categoryId = resolvedCategories[0].id;
    const categorySlugFromResolve = resolvedCategories[0].slug ?? '';

    const resolvedAuth = resolveShortPostWordpressAuth(user);
    if (!resolvedAuth) {
      throw forbidden(
        'WordPress credentials unavailable. Ask an admin to provision WordPress access, or configure ENV_API_WORDPRESS_ADMIN_USER/PASSWORD.'
      );
    }
    const { auth: wpAuth, isAuthorAuth } = resolvedAuth;

    let authorId: number | undefined;
    if (!isAuthorAuth && user.wordpressId != null) {
      const exists = await this.wordpressService.userExists(user.wordpressId);
      if (exists) {
        authorId = user.wordpressId;
      } else {
        logger.warn(
          { userId: user.id, wordpressId: user.wordpressId },
          'App wordpressId not found on target WordPress; creating post as admin'
        );
      }
    }

    // Best-effort: if app has a photo but PublishPress avatar is missing, sync in background
    // so WP bylines catch up without delaying the create response.
    void userAvatarService
      .syncAppPhotoIfMissingPublishPressAvatar({
        userId: user.id,
        wordpressId: user.wordpressId,
        photoUrl: user.photoUrl,
      })
      .catch((err) => {
        logger.warn(
          { err, userId: user.id, wordpressId: user.wordpressId },
          'Background avatar sync on post create failed'
        );
      });

    if (postType === 'article') {
      await this.createArticlePost({
        res,
        userId: user.id,
        userName: user.name,
        meta,
        body,
        categoryId,
        categorySlugFromResolve,
        thumbFile,
        wpAuth,
        isAuthorAuth,
        authorId,
      });
      return;
    }

    await this.createVideoPost({
      res,
      userId: user.id,
      userName: user.name,
      meta,
      body,
      categoryId,
      categorySlugFromResolve,
      file: file!,
      thumbFile,
      wpAuth,
      isAuthorAuth,
      authorId,
    });
  };

  private createVideoPost = async (ctx: {
    res: Response;
    userId: string;
    userName: string;
    meta: ShortPostMeta | null;
    body: {
      descriptionHtml?: string | string[];
      descriptionText?: string | string[];
      title?: string | string[];
    };
    categoryId: number;
    categorySlugFromResolve: string;
    file: Express.Multer.File;
    thumbFile: Express.Multer.File | undefined;
    wpAuth: WordpressBasicAuth;
    isAuthorAuth: boolean;
    authorId: number | undefined;
  }): Promise<void> => {
    const {
      res,
      userId,
      userName,
      meta,
      body,
      categoryId,
      categorySlugFromResolve,
      file,
      thumbFile,
      wpAuth,
      isAuthorAuth,
      authorId,
    } = ctx;

    const rawDescriptionHtml =
      (typeof meta?.descriptionHtml === 'string' ? meta.descriptionHtml : '') ||
      firstFormString(body.descriptionHtml);
    const rawDescriptionText =
      (typeof meta?.descriptionText === 'string' ? meta.descriptionText : '') ||
      firstFormString(body.descriptionText);
    let descriptionHtml = sanitizePostDescriptionHtml(rawDescriptionHtml);
    let plainDescription = plainTextFromHtml(descriptionHtml);
    if (!plainDescription && rawDescriptionText.trim()) {
      descriptionHtml = sanitizePostDescriptionHtml(
        `<p>${escapeHtmlAttr(rawDescriptionText.trim())}</p>`
      );
      plainDescription = plainTextFromHtml(descriptionHtml);
    }
    const excerptRaw =
      descriptionHtml.trim() ||
      (plainDescription ? `<p>${escapeHtmlAttr(plainDescription)}</p>` : '');

    if (!plainDescription) {
      logger.warn(
        {
          userId,
          hasMetaFile: Boolean(meta),
          htmlFieldLen: rawDescriptionHtml.length,
          textFieldLen: rawDescriptionText.length,
        },
        'Short post caption missing after multipart parse'
      );
      throw validationError('A legenda é obrigatória');
    }

    logger.info(
      {
        userId,
        excerptLen: excerptRaw.length,
        plainLen: plainDescription.length,
        fromMeta: Boolean(meta),
      },
      'Short post caption received'
    );

    const titleFromMeta =
      typeof meta?.title === 'string' && meta.title.trim() ? meta.title.trim() : '';
    const titleFromBody = firstFormString(body.title).trim();
    const rawTitle = titleFromMeta || titleFromBody || plainDescription || `Postagem de ${userName}`;
    const title = truncate(rawTitle, 80);

    const filename =
      file.originalname?.replace(/[^\w.\-]+/g, '_') ||
      `short-${Date.now()}.mp4`;

    let mediaId: number | null = null;
    let thumbMediaId: number | null = null;
    let postCreated = false;
    try {
      const media = await this.wordpressService.uploadMedia({
        buffer: file.buffer,
        filename,
        mimeType: file.mimetype,
        authorId: isAuthorAuth ? undefined : authorId,
        auth: wpAuth,
      });
      mediaId = media.id;

      let posterUrl = '';
      if (thumbFile?.buffer?.length) {
        const thumbExt =
          thumbFile.mimetype === 'image/png'
            ? 'png'
            : thumbFile.mimetype === 'image/webp'
              ? 'webp'
              : 'jpg';
        const thumb = await this.wordpressService.uploadMedia({
          buffer: thumbFile.buffer,
          filename: `short-poster-${Date.now()}.${thumbExt}`,
          mimeType: thumbFile.mimetype,
          authorId: isAuthorAuth ? undefined : authorId,
          auth: wpAuth,
        });
        thumbMediaId = thumb.id;
        posterUrl = thumb.sourceUrl;
      }

      const posterAttr = posterUrl
        ? ` poster="${escapeHtmlAttr(posterUrl)}"`
        : '';
      const content = `<figure class="wp-block-video"><video controls${posterAttr} src="${escapeHtmlAttr(media.sourceUrl)}"></video></figure>`;

      if (!isSingleVideoContent(content)) {
        logger.error({ userId }, 'Short post content failed onlyVideo check');
      }

      const created = await this.wordpressService.createPost({
        title,
        content,
        excerpt: excerptRaw,
        author: authorId,
        categories: [categoryId],
        featuredMedia: thumbMediaId ?? undefined,
        auth: wpAuth,
      });
      postCreated = true;

      sendJsonSuccess(res, {
        id: created.id,
        slug: created.slug,
        categorySlug: categorySlugFromResolve,
        onlyVideo: true as const,
      });
    } catch (e) {
      if (!postCreated) {
        if (mediaId != null) {
          await this.wordpressService.deleteMedia(mediaId, wpAuth);
        }
        if (thumbMediaId != null) {
          await this.wordpressService.deleteMedia(thumbMediaId, wpAuth);
        }
      }
      this.rethrowCreateError(e, userId);
    }
  };

  private createArticlePost = async (ctx: {
    res: Response;
    userId: string;
    userName: string;
    meta: ShortPostMeta | null;
    body: {
      contentHtml?: string | string[];
      descriptionHtml?: string | string[];
      descriptionText?: string | string[];
      title?: string | string[];
      summary?: string | string[];
    };
    categoryId: number;
    categorySlugFromResolve: string;
    thumbFile: Express.Multer.File | undefined;
    wpAuth: WordpressBasicAuth;
    isAuthorAuth: boolean;
    authorId: number | undefined;
  }): Promise<void> => {
    const {
      res,
      userId,
      meta,
      body,
      categoryId,
      categorySlugFromResolve,
      thumbFile,
      wpAuth,
      isAuthorAuth,
      authorId,
    } = ctx;

    const rawContentHtml =
      (typeof meta?.contentHtml === 'string' ? meta.contentHtml : '') ||
      firstFormString(body.contentHtml) ||
      (typeof meta?.descriptionHtml === 'string' ? meta.descriptionHtml : '') ||
      firstFormString(body.descriptionHtml);
    const rawDescriptionText =
      (typeof meta?.descriptionText === 'string' ? meta.descriptionText : '') ||
      firstFormString(body.descriptionText);

    let articleHtml = sanitizePostArticleHtml(rawContentHtml);
    let plain = plainTextFromHtml(articleHtml);
    if (!plain && rawDescriptionText.trim()) {
      articleHtml = sanitizePostArticleHtml(
        `<p>${escapeHtmlAttr(rawDescriptionText.trim())}</p>`
      );
      plain = plainTextFromHtml(articleHtml);
    }

    if (!plain) {
      throw validationError('O conteúdo do artigo é obrigatório');
    }

    const titleFromMeta =
      typeof meta?.title === 'string' && meta.title.trim() ? meta.title.trim() : '';
    const titleFromBody = firstFormString(body.title).trim();
    const rawTitle = titleFromMeta || titleFromBody;
    if (!rawTitle) {
      throw validationError('O título do artigo é obrigatório');
    }
    const title = truncate(rawTitle, 80);

    const content = wrapHtmlAsGutenbergBlocks(articleHtml);
    const rawSummary =
      (typeof meta?.summary === 'string' ? meta.summary : '') ||
      firstFormString(body.summary);
    const summaryPlain = rawSummary.replace(/\s+/g, ' ').trim();
    const autoExcerpt = truncate(plain.replace(/\s+/g, ' ').trim(), 280);
    const excerptRaw = `<p>${escapeHtmlAttr(summaryPlain ? truncate(summaryPlain, 280) : autoExcerpt)}</p>`;

    logger.info(
      {
        userId,
        contentLen: content.length,
        plainLen: plain.length,
        fromMeta: Boolean(meta),
      },
      'Article post content received'
    );

    let thumbMediaId: number | null = null;
    let postCreated = false;
    try {
      if (thumbFile?.buffer?.length) {
        const thumbExt =
          thumbFile.mimetype === 'image/png'
            ? 'png'
            : thumbFile.mimetype === 'image/webp'
              ? 'webp'
              : 'jpg';
        const thumb = await this.wordpressService.uploadMedia({
          buffer: thumbFile.buffer,
          filename: `article-cover-${Date.now()}.${thumbExt}`,
          mimeType: thumbFile.mimetype,
          authorId: isAuthorAuth ? undefined : authorId,
          auth: wpAuth,
        });
        thumbMediaId = thumb.id;
      }

      const created = await this.wordpressService.createPost({
        title,
        content,
        excerpt: excerptRaw,
        author: authorId,
        categories: [categoryId],
        featuredMedia: thumbMediaId ?? undefined,
        auth: wpAuth,
      });
      postCreated = true;

      sendJsonSuccess(res, {
        id: created.id,
        slug: created.slug,
        categorySlug: categorySlugFromResolve,
        onlyVideo: false as const,
      });
    } catch (e) {
      if (!postCreated && thumbMediaId != null) {
        await this.wordpressService.deleteMedia(thumbMediaId, wpAuth);
      }
      this.rethrowCreateError(e, userId);
    }
  };

  private rethrowCreateError(e: unknown, userId: string): never {
    if (e && typeof e === 'object' && 'statusCode' in e) {
      throw e;
    }
    const message = e instanceof Error ? e.message : 'Failed to create post';
    logger.error({ err: e, userId }, 'Post create failed');
    if (/Unauthorized|rest_cannot_create|401/i.test(message)) {
      throw forbidden(
        'WordPress rejected the upload (unauthorized). Check ENV_API_WORDPRESS_ADMIN_USER/PASSWORD (Application Password). Author account passwords cannot authenticate to the WP REST API.'
      );
    }
    if (/rest_invalid_author/i.test(message)) {
      throw validationError(
        'Invalid WordPress author id. Re-provision WordPress access for this user on the connected WordPress site.'
      );
    }
    throw badGateway(message);
  }

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

    const base = await toPostDetailWithAppAuthor(post, categories, tags, defaultAvatarUrl);
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
