import type { Request, Response } from 'express';
import {
  WordpressService,
  type WordpressAuthorListPost,
  type WordpressBasicAuth,
  type WordpressEditPost,
} from '../services/wordpress.service';
import { extractPostVideo, isSingleVideoContent } from '../helpers/content.helper';
import {
  plainTextFromHtml,
  sanitizePostArticleHtml,
  sanitizePostDescriptionHtml,
} from '../helpers/sanitizePostDescription.helper';
import { wrapHtmlAsGutenbergBlocks } from '../helpers/gutenbergBlocks.helper';
import {
  escapeHtmlAttr,
  resolveShortPostWordpressAuth,
  stripGutenbergBlockComments,
  truncate,
} from '../helpers/shortPost.helper';
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

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function categorySlugFromEmbed(post: WordpressAuthorListPost): string {
  const terms = post._embedded?.['wp:term'];
  if (!Array.isArray(terms)) return '';
  for (const group of terms) {
    if (!Array.isArray(group)) continue;
    const cat = group.find((t) => t.taxonomy === 'category');
    if (cat?.slug) return cat.slug;
  }
  return '';
}

function thumbnailFromEmbed(post: WordpressAuthorListPost): string {
  const media = post._embedded?.['wp:featuredmedia']?.[0];
  return (
    media?.media_details?.sizes?.large?.source_url ??
    media?.source_url ??
    ''
  );
}

export class MyPostsController {
  constructor(private readonly wordpressService: WordpressService) {}

  private resolveAuth(user: NonNullable<Request['appUser']>): {
    auth: WordpressBasicAuth;
    wordpressId: number;
  } {
    if (user.wordpressId == null) {
      throw unauthorized('User has no WordPress author account');
    }
    const resolved = resolveShortPostWordpressAuth(user);
    if (!resolved) {
      throw forbidden(
        'WordPress credentials unavailable. Ask an admin to provision WordPress access, or configure ENV_API_WORDPRESS_ADMIN_USER/PASSWORD.'
      );
    }
    return { auth: resolved.auth, wordpressId: user.wordpressId };
  }

  /** Load post for edit and ensure it belongs to the app user's wordpressId. */
  private async loadOwnedPost(
    postId: number,
    wordpressId: number,
    auth: WordpressBasicAuth
  ): Promise<WordpressEditPost> {
    const post = await this.wordpressService.getPostForEdit(postId, auth);
    if (!post || post.author !== wordpressId) {
      throw notFound('Post not found');
    }
    return post;
  }

  list = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) throw unauthorized('Unauthorized');
    const { auth, wordpressId } = this.resolveAuth(user);

    const page = Math.max(1, Number(req.query.page) || 1);
    const perPageRaw = Number(req.query.perPage) || 20;
    const perPage = Math.min(50, Math.max(1, Number.isFinite(perPageRaw) ? perPageRaw : 20));

    try {
      const { posts, totalPages, total } = await this.wordpressService.getPostsByAuthorPaged(
        wordpressId,
        page,
        perPage,
        auth
      );

      const items = posts.map((post) => {
        const contentHtml = post.content?.rendered ?? post.content?.raw ?? '';
        const excerptHtml = post.excerpt?.rendered ?? post.excerpt?.raw ?? '';
        const type = isSingleVideoContent(contentHtml) ? ('video' as const) : ('article' as const);
        const titleRaw = post.title?.raw ?? post.title?.rendered ?? '';
        return {
          id: post.id,
          slug: post.slug,
          categorySlug: categorySlugFromEmbed(post),
          title: decodeHtmlEntities(titleRaw.replace(/<[^>]+>/g, '').trim()),
          type,
          excerptPlain: plainTextFromHtml(excerptHtml),
          thumbnailUrl: thumbnailFromEmbed(post),
          status: post.status,
          date: post.date,
          modified: post.modified,
        };
      });

      sendJsonSuccess(res, {
        items,
        page,
        perPage,
        totalPages,
        total,
        hasMore: page < totalPages,
      });
    } catch (e) {
      if (e && typeof e === 'object' && 'statusCode' in e) throw e;
      const message = e instanceof Error ? e.message : 'Failed to list posts';
      logger.error({ err: e, userId: user.id }, 'My posts list failed');
      throw badGateway(message);
    }
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) throw unauthorized('Unauthorized');
    const { auth, wordpressId } = this.resolveAuth(user);

    const postId = Number(req.params.id);
    if (!Number.isFinite(postId) || postId <= 0) {
      throw badRequest('Invalid post id');
    }

    try {
      const post = await this.loadOwnedPost(postId, wordpressId, auth);
      const contentRaw = post.content?.raw ?? post.content?.rendered ?? '';
      const excerptRaw = post.excerpt?.raw ?? post.excerpt?.rendered ?? '';
      const isVideo = isSingleVideoContent(contentRaw || post.content?.rendered || '');
      const type = isVideo ? ('video' as const) : ('article' as const);

      const video = isVideo
        ? extractPostVideo(contentRaw || post.content?.rendered || '')
        : null;

      let thumbnailUrl = '';
      if (post.featured_media > 0) {
        try {
          const full = await this.wordpressService.getPost(post.id);
          thumbnailUrl =
            full._embedded?.['wp:featuredmedia']?.[0]?.source_url ??
            full._embedded?.['wp:featuredmedia']?.[0]?.media_details?.sizes?.large
              ?.source_url ??
            '';
        } catch {
          thumbnailUrl = video?.thumbnailUrl ?? '';
        }
      } else {
        thumbnailUrl = video?.thumbnailUrl ?? '';
      }

      const contentForEdit = isVideo
        ? undefined
        : stripGutenbergBlockComments(contentRaw);
      let summary: string | undefined;
      if (!isVideo) {
        const excerptPlain = plainTextFromHtml(excerptRaw).replace(/\s+/g, ' ').trim();
        const autoExcerpt = truncate(
          plainTextFromHtml(contentForEdit ?? '').replace(/\s+/g, ' ').trim(),
          280
        );
        summary = excerptPlain && excerptPlain !== autoExcerpt ? excerptPlain : '';
      }

      sendJsonSuccess(res, {
        id: post.id,
        slug: post.slug,
        type,
        title: decodeHtmlEntities((post.title?.raw ?? '').trim()),
        categoryId: post.categories?.[0] ?? null,
        descriptionHtml: isVideo ? excerptRaw : undefined,
        contentHtml: contentForEdit,
        summary,
        thumbnailUrl,
        videoUrl: video?.contentUrl ?? undefined,
        status: post.status,
      });
    } catch (e) {
      if (e && typeof e === 'object' && 'statusCode' in e) throw e;
      const message = e instanceof Error ? e.message : 'Failed to load post';
      logger.error({ err: e, userId: user.id, postId }, 'My post getOne failed');
      throw badGateway(message);
    }
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) throw unauthorized('Unauthorized');
    const { auth, wordpressId } = this.resolveAuth(user);

    const postId = Number(req.params.id);
    if (!Number.isFinite(postId) || postId <= 0) {
      throw badRequest('Invalid post id');
    }

    const body = req.body as {
      title?: string;
      descriptionHtml?: string;
      contentHtml?: string;
      summary?: string;
      categoryId?: number | string;
    };

    try {
      const post = await this.loadOwnedPost(postId, wordpressId, auth);
      const contentRaw = post.content?.raw ?? post.content?.rendered ?? '';
      const isVideo = isSingleVideoContent(contentRaw || post.content?.rendered || '');

      let categoryId: number | undefined;
      if (body.categoryId != null && body.categoryId !== '') {
        const categoryIdNum = Number(body.categoryId);
        if (!Number.isFinite(categoryIdNum) || categoryIdNum <= 0) {
          throw validationError('Invalid categoryId');
        }
        const resolved = await this.wordpressService.getCategoriesById([categoryIdNum]);
        if (!resolved.length) {
          throw validationError('Invalid categoryId');
        }
        categoryId = resolved[0].id;
      }

      if (isVideo) {
        await this.updateVideoPost({
          res,
          postId,
          post,
          body,
          categoryId,
          auth,
        });
        return;
      }

      await this.updateArticlePost({
        res,
        postId,
        post,
        body,
        categoryId,
        auth,
      });
    } catch (e) {
      if (e && typeof e === 'object' && 'statusCode' in e) throw e;
      const message = e instanceof Error ? e.message : 'Failed to update post';
      logger.error({ err: e, userId: user.id, postId }, 'My post update failed');
      if (/Unauthorized|rest_cannot|401/i.test(message)) {
        throw forbidden('WordPress rejected the update (unauthorized).');
      }
      throw badGateway(message);
    }
  };

  private updateVideoPost = async (ctx: {
    res: Response;
    postId: number;
    post: WordpressEditPost;
    body: {
      title?: string;
      descriptionHtml?: string;
      contentHtml?: string;
      categoryId?: number | string;
    };
    categoryId: number | undefined;
    auth: WordpressBasicAuth;
  }): Promise<void> => {
    const { res, postId, post, body, categoryId, auth } = ctx;

    const rawDescriptionHtml =
      typeof body.descriptionHtml === 'string'
        ? body.descriptionHtml
        : typeof body.contentHtml === 'string'
          ? body.contentHtml
          : post.excerpt?.raw ?? '';

    const descriptionHtml = sanitizePostDescriptionHtml(rawDescriptionHtml);
    const plainDescription = plainTextFromHtml(descriptionHtml);
    if (!plainDescription) {
      throw validationError('A legenda é obrigatória');
    }

    const excerptRaw =
      descriptionHtml.trim() ||
      (plainDescription ? `<p>${escapeHtmlAttr(plainDescription)}</p>` : '');

    const titleFromBody =
      typeof body.title === 'string' ? body.title.trim() : '';
    const rawTitle =
      titleFromBody ||
      (post.title?.raw ?? '').trim() ||
      plainDescription;
    const title = truncate(rawTitle, 80);

    const updated = await this.wordpressService.updatePost(
      postId,
      {
        title,
        excerpt: excerptRaw,
        ...(categoryId != null ? { categories: [categoryId] } : {}),
      },
      auth
    );

    const cats =
      categoryId != null
        ? await this.wordpressService.getCategoriesById([categoryId])
        : post.categories?.length
          ? await this.wordpressService.getCategoriesById([post.categories[0]])
          : [];

    sendJsonSuccess(res, {
      id: updated.id,
      slug: updated.slug,
      categorySlug: cats[0]?.slug ?? '',
      onlyVideo: true as const,
    });
  };

  private updateArticlePost = async (ctx: {
    res: Response;
    postId: number;
    post: WordpressEditPost;
    body: {
      title?: string;
      descriptionHtml?: string;
      contentHtml?: string;
      summary?: string;
      categoryId?: number | string;
    };
    categoryId: number | undefined;
    auth: WordpressBasicAuth;
  }): Promise<void> => {
    const { res, postId, post, body, categoryId, auth } = ctx;

    const rawContentHtml =
      typeof body.contentHtml === 'string'
        ? body.contentHtml
        : typeof body.descriptionHtml === 'string'
          ? body.descriptionHtml
          : stripGutenbergBlockComments(post.content?.raw ?? '');

    const articleHtml = sanitizePostArticleHtml(rawContentHtml);
    const plain = plainTextFromHtml(articleHtml);
    if (!plain) {
      throw validationError('O conteúdo do artigo é obrigatório');
    }

    const titleFromBody =
      typeof body.title === 'string' ? body.title.trim() : '';
    const rawTitle = titleFromBody || (post.title?.raw ?? '').trim();
    if (!rawTitle) {
      throw validationError('O título do artigo é obrigatório');
    }
    const title = truncate(rawTitle, 80);

    const content = wrapHtmlAsGutenbergBlocks(articleHtml);
    const plainNormalized = plain.replace(/\s+/g, ' ').trim();
    const autoExcerpt = truncate(plainNormalized, 280);

    let excerptSource = autoExcerpt;
    if (typeof body.summary === 'string') {
      const summaryPlain = body.summary.replace(/\s+/g, ' ').trim();
      excerptSource = summaryPlain ? truncate(summaryPlain, 280) : autoExcerpt;
    } else {
      const currentExcerptPlain = plainTextFromHtml(
        post.excerpt?.raw ?? post.excerpt?.rendered ?? ''
      )
        .replace(/\s+/g, ' ')
        .trim();
      if (currentExcerptPlain && currentExcerptPlain !== autoExcerpt) {
        excerptSource = truncate(currentExcerptPlain, 280);
      }
    }
    const excerptRaw = `<p>${escapeHtmlAttr(excerptSource)}</p>`;

    const updated = await this.wordpressService.updatePost(
      postId,
      {
        title,
        content,
        excerpt: excerptRaw,
        ...(categoryId != null ? { categories: [categoryId] } : {}),
      },
      auth
    );

    const cats =
      categoryId != null
        ? await this.wordpressService.getCategoriesById([categoryId])
        : post.categories?.length
          ? await this.wordpressService.getCategoriesById([post.categories[0]])
          : [];

    sendJsonSuccess(res, {
      id: updated.id,
      slug: updated.slug,
      categorySlug: cats[0]?.slug ?? '',
      onlyVideo: false as const,
    });
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) throw unauthorized('Unauthorized');
    const { auth, wordpressId } = this.resolveAuth(user);

    const postId = Number(req.params.id);
    if (!Number.isFinite(postId) || postId <= 0) {
      throw badRequest('Invalid post id');
    }

    try {
      await this.loadOwnedPost(postId, wordpressId, auth);
      await this.wordpressService.trashPost(postId, auth);
      sendJsonSuccess(res, { id: postId, deleted: true });
    } catch (e) {
      if (e && typeof e === 'object' && 'statusCode' in e) throw e;
      const message = e instanceof Error ? e.message : 'Failed to delete post';
      logger.error({ err: e, userId: user.id, postId }, 'My post delete failed');
      if (/Unauthorized|rest_cannot|401/i.test(message)) {
        throw forbidden('WordPress rejected the delete (unauthorized).');
      }
      throw badGateway(message);
    }
  };
}
