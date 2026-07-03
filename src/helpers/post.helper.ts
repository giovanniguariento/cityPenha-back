import { ETypePost, type IPost } from '../models/post.interface';
import type { Author } from '../types';
import type { FeedItem, PostDetailBase } from '../types';
import type { ICategory } from '../models/category.interface';
import type { ITag } from '../models/tag.interface';
import { isSingleVideoContent } from './content.helper';
import type { WordpressService } from '../services/wordpress.service';
import { HARDCODED_AUTHOR_AVATAR_FALLBACK } from './wordpressDefaultAvatar.helper';

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

function resolveContentAuthor(post: IPost, defaultAvatarUrl: string): Author {
  const ppAuthor = post.authors?.[0];
  if (ppAuthor) {
    const avatarUrl =
      firstNonEmpty(
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
      avatarUrl: firstNonEmpty(wpAuthor.avatar_urls?.['96']) ?? defaultAvatarUrl,
    };
  }

  return { name: '', avatarUrl: defaultAvatarUrl };
}

export function getAuthor(
  post: IPost,
  defaultAvatarUrl: string = HARDCODED_AUTHOR_AVATAR_FALLBACK
): Author {
  if (post.type === ETypePost.POST) {
    return resolveContentAuthor(post, defaultAvatarUrl);
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

export function toFeedItem(
  post: IPost,
  defaultAvatarUrl: string = HARDCODED_AUTHOR_AVATAR_FALLBACK
): FeedItem {
  return {
    slug: post.slug,
    id: post.id,
    title: post.title.rendered,
    type: post.type,
    author: getAuthor(post, defaultAvatarUrl),
    tags: post.tags,
    readingTime: post.acf.reading_time,
    image: getFeaturedImageUrl(post),
    categories: post.categories,
    categoryName: '',
    categorySlug: '',
    onlyVideo: isSingleVideoContent(post.content.rendered),
  } as FeedItem;
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
  defaultAvatarUrl: string = HARDCODED_AUTHOR_AVATAR_FALLBACK
): PostDetailBase {
  const tagNames = post.tags
    .map((tagId) => tags.find((t) => t.id === tagId)?.name)
    .filter((name): name is string => name != null);

  return {
    id: post.id,
    slug: post.slug,
    type: post.type,
    title: post.title.rendered,
    resume: post.excerpt.rendered,
    readingTime: post.acf.reading_time,
    date: String(post.date),
    author: getAuthor(post, defaultAvatarUrl),
    image: getFeaturedImageUrl(post),
    content: post.content.rendered,
    tags: tagNames,
    categoryName: categories[0]?.name ?? '',
    categorySlug: categories[0]?.slug ?? '',
    onlyVideo: isSingleVideoContent(post.content.rendered),
  };
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
