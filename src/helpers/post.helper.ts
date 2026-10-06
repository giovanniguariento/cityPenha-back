import { ETypePost, type IPost } from '../models/post.interface';
import type { Author } from '../types';
import type { FeedItem, PostDetailBase } from '../types';
import type { ICategory } from '../models/category.interface';
import type { ITag } from '../models/tag.interface';
import { extractPostVideo, isSingleVideoContent, prepareWatchPageMedia } from './content.helper';
import type { WordpressService } from '../services/wordpress.service';
import { HARDCODED_AUTHOR_AVATAR_FALLBACK } from './wordpressDefaultAvatar.helper';
import { prisma } from '../lib/prisma';

function firstNonEmpty(...values: (string | null | undefined)[]): string | undefined {
  for (const v of values) {
    const t = v?.trim();
    if (t) return t;
  }
  return undefined;
}

function extractPublishPressAvatarUrl(
  avatarUrl: string | { url?: string } | undefined
): string | undefined {
  if (avatarUrl == null) return undefined;
  if (typeof avatarUrl === 'string') return firstNonEmpty(avatarUrl);
  return firstNonEmpty(avatarUrl.url);
}

/** App profile fields keyed by WordPress user id (bylines prefer these over WP/PP). */
export type AppAuthorProfile = {
  name?: string;
  photoUrl?: string;
};

function resolveContentAuthor(
  post: IPost,
  defaultAvatarUrl: string,
  appPhotoUrl?: string
): Author {
  const ppAuthor = post.authors?.[0];
  if (ppAuthor) {
    const avatarUrl =
      firstNonEmpty(
        appPhotoUrl,
        extractPublishPressAvatarUrl(ppAuthor.avatar_url),
        post._embedded?.author?.[0]?.avatar_urls?.['96']
      ) ?? defaultAvatarUrl;
    return {
      name: ppAuthor.display_name ?? '',
      avatarUrl,
    };
  }

  const wpAuthor = post._embedded?.author?.[0];
  if (wpAuthor) {
    return {
      name: wpAuthor.name ?? '',
      avatarUrl:
        firstNonEmpty(appPhotoUrl, wpAuthor.avatar_urls?.['96']) ?? defaultAvatarUrl,
    };
  }

  return {
    name: '',
    avatarUrl: firstNonEmpty(appPhotoUrl) ?? defaultAvatarUrl,
  };
}

/** WordPress user id for the primary content author, when available. */
export function getWordpressAuthorUserId(post: IPost): number | null {
  const fromPp = post.authors?.[0]?.user_id;
  if (typeof fromPp === 'number' && Number.isFinite(fromPp) && fromPp > 0) {
    return fromPp;
  }
  if (typeof post.author === 'number' && Number.isFinite(post.author) && post.author > 0) {
    return post.author;
  }
  const fromEmbedded = post._embedded?.author?.[0]?.id;
  if (typeof fromEmbedded === 'number' && Number.isFinite(fromEmbedded) && fromEmbedded > 0) {
    return fromEmbedded;
  }
  return null;
}

/**
 * App profile name + photoUrl keyed by WordPress user id.
 * Prefer these over WordPress / PublishPress when rendering bylines.
 */
export async function loadAppAuthorProfilesByWordpressId(
  wordpressUserIds: Array<number | null | undefined>
): Promise<Map<number, AppAuthorProfile>> {
  const ids = [
    ...new Set(
      wordpressUserIds.filter(
        (id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0
      )
    ),
  ];
  if (ids.length === 0) {
    return new Map();
  }

  const users = await prisma.user.findMany({
    where: { wordpressId: { in: ids } },
    select: { wordpressId: true, name: true, photoUrl: true },
  });

  const map = new Map<number, AppAuthorProfile>();
  for (const u of users) {
    if (u.wordpressId == null) continue;
    const name = u.name?.trim();
    const photoUrl = u.photoUrl?.trim();
    if (!name && !photoUrl) continue;
    map.set(u.wordpressId, {
      ...(name ? { name } : {}),
      ...(photoUrl ? { photoUrl } : {}),
    });
  }
  return map;
}

function applyAppAuthorProfile(
  author: Author,
  post: IPost,
  appProfiles?: Map<number, AppAuthorProfile>
): Author {
  if (!appProfiles || appProfiles.size === 0) {
    return author;
  }
  const wpId = getWordpressAuthorUserId(post);
  if (wpId == null) {
    return author;
  }
  const profile = appProfiles.get(wpId);
  if (!profile) {
    return author;
  }
  const appName = profile.name?.trim();
  // Photo is applied in resolveContentAuthor; here only override name if present.
  if (!appName) {
    return author;
  }
  return { ...author, name: appName };
}

function getAuthor(
  post: IPost,
  defaultAvatarUrl: string = HARDCODED_AUTHOR_AVATAR_FALLBACK,
  appProfiles?: Map<number, AppAuthorProfile>
): Author {
  if (post.type === ETypePost.POST) {
    const wpId = getWordpressAuthorUserId(post);
    const appPhotoUrl =
      wpId != null ? appProfiles?.get(wpId)?.photoUrl : undefined;
    return applyAppAuthorProfile(
      resolveContentAuthor(post, defaultAvatarUrl, appPhotoUrl),
      post,
      appProfiles
    );
  }
  return { name: 'Patrocinado', avatarUrl: defaultAvatarUrl };
}

export function getFeaturedImageUrl(post: IPost): string {
  const media = post._embedded?.['wp:featuredmedia'];
  return (
    media?.[0]?.media_details?.sizes?.large?.source_url ??
    media?.[0]?.source_url ??
    ''
  );
}

/**
 * Original (unresized) featured image. Google wants video thumbnails at least
 * 1200 px wide, so structured data must not use the `large` variant.
 */
export function getFeaturedImageOriginalUrl(post: IPost): string {
  const media = post._embedded?.['wp:featuredmedia'];
  return media?.[0]?.source_url ?? getFeaturedImageUrl(post);
}

export function toFeedItem(
  post: IPost,
  defaultAvatarUrl: string = HARDCODED_AUTHOR_AVATAR_FALLBACK,
  appProfiles?: Map<number, AppAuthorProfile>
): FeedItem {
  return {
    slug: post.slug,
    id: post.id,
    title: post.title.rendered,
    type: post.type,
    author: getAuthor(post, defaultAvatarUrl, appProfiles),
    tags: post.tags,
    readingTime: post.acf.reading_time,
    image: getFeaturedImageUrl(post),
    categories: post.categories,
    categoryName: '',
    categorySlug: '',
    onlyVideo: isSingleVideoContent(post.content.rendered),
  } as FeedItem;
}

/** Batch-convert posts to feed items, preferring app profile name + photo for bylines. */
export async function toFeedItems(
  posts: IPost[],
  defaultAvatarUrl: string = HARDCODED_AUTHOR_AVATAR_FALLBACK
): Promise<FeedItem[]> {
  const appProfiles = await loadAppAuthorProfilesByWordpressId(
    posts.map(getWordpressAuthorUserId)
  );
  return posts.map((post) => toFeedItem(post, defaultAvatarUrl, appProfiles));
}

export function enrichFeedItemCategory(
  item: FeedItem,
  categoryById: Map<number, ICategory>
): void {
  for (const id of item.categories) {
    const cat = categoryById.get(id);
    if (cat) {
      item.categoryName = cat.name;
      item.categorySlug = cat.slug;
      break;
    }
  }
}

export function toPostDetail(
  post: IPost,
  categories: ICategory[],
  tags: ITag[],
  defaultAvatarUrl: string = HARDCODED_AUTHOR_AVATAR_FALLBACK,
  appProfiles?: Map<number, AppAuthorProfile>
): PostDetailBase {
  const tagNames = post.tags
    .map((tagId) => tags.find((t) => t.id === tagId)?.name)
    .filter((name): name is string => name != null);

  const onlyVideo = isSingleVideoContent(post.content.rendered);
  const video = onlyVideo
    ? extractPostVideo(post.content.rendered, getFeaturedImageOriginalUrl(post) || undefined)
    : null;

  return {
    id: post.id,
    slug: post.slug,
    type: post.type,
    title: post.title.rendered,
    resume: post.excerpt.rendered,
    readingTime: post.acf.reading_time,
    date: String(post.date),
    author: getAuthor(post, defaultAvatarUrl, appProfiles),
    image: getFeaturedImageUrl(post),
    content: onlyVideo
      ? prepareWatchPageMedia(post.content.rendered, video?.thumbnailUrl)
      : post.content.rendered,
    tags: tagNames,
    categoryName: categories[0]?.name ?? '',
    categorySlug: categories[0]?.slug ?? '',
    onlyVideo,
    ...(video ? { video } : {}),
  };
}

export async function toPostDetailWithAppAuthor(
  post: IPost,
  categories: ICategory[],
  tags: ITag[],
  defaultAvatarUrl: string = HARDCODED_AUTHOR_AVATAR_FALLBACK
): Promise<PostDetailBase> {
  const appProfiles = await loadAppAuthorProfilesByWordpressId([
    getWordpressAuthorUserId(post),
  ]);
  return toPostDetail(post, categories, tags, defaultAvatarUrl, appProfiles);
}

/** Busca post de conteúdo ou anúncio por ID; `null` se não existir. */
export async function fetchPostOrAd(
  wordpressService: WordpressService,
  wordpressPostId: number,
  prefer?: 'post' | 'ad'
): Promise<IPost | null> {
  const tryPostFirst = prefer !== 'ad';
  const first = tryPostFirst
    ? () => wordpressService.getPost(wordpressPostId)
    : () => wordpressService.getAd(wordpressPostId);
  const second = tryPostFirst
    ? () => wordpressService.getAd(wordpressPostId)
    : () => wordpressService.getPost(wordpressPostId);

  try {
    return await first();
  } catch {
    try {
      return await second();
    } catch {
      return null;
    }
  }
}

/** Verifica se existe post ou anúncio no WordPress com esse ID. */
export async function verifyWordpressPostExists(
  wordpressService: WordpressService,
  wordpressPostId: number
): Promise<boolean> {
  try {
    await wordpressService.getPost(wordpressPostId);
    return true;
  } catch {
    try {
      await wordpressService.getAd(wordpressPostId);
      return true;
    } catch {
      return false;
    }
  }
}

/** Busca URL da imagem de destaque (post ou anúncio). */
export async function fetchFeaturedImageUrl(
  wordpressService: WordpressService,
  wordpressPostId: number
): Promise<string | null> {
  try {
    const post = await wordpressService.getPost(wordpressPostId);
    const url = getFeaturedImageUrl(post);
    return url || null;
  } catch {
    try {
      const ad = await wordpressService.getAd(wordpressPostId);
      const url = getFeaturedImageUrl(ad);
      return url || null;
    } catch {
      return null;
    }
  }
}
