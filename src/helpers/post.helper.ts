import { ETypePost, type IPost } from '../models/post.interface';
import type { Author } from '../types';
import type { FeedItem, PostDetailResponse } from '../types';
import type { ICategory } from '../models/category.interface';
import type { ITag } from '../models/tag.interface';
import { isSingleVideoContent } from './content.helper';

const SPONSORED_AUTHOR: Author = {
  name: 'Patrocinado',
  avatarUrl: 'assets/logo-perfil.svg',
};

export function getAuthor(post: IPost): Author {
  if (post.type === ETypePost.POST) {
    return {
      name: post.authors[0].display_name,
      avatarUrl: post.authors[0].avatar_url.url,
    };
  }
  return SPONSORED_AUTHOR;
}

export function getFeaturedImageUrl(post: IPost): string {
  const media = post._embedded?.['wp:featuredmedia'];
  return media?.[0]?.source_url ?? '';
}

export function toFeedItem(post: IPost): FeedItem {
  return {
    slug: post.slug,
    id: post.id,
    title: post.title.rendered,
    type: post.type,
    author: getAuthor(post),
    tags: post.tags,
    readingTime: post.acf.reading_time,
    image: getFeaturedImageUrl(post),
    categories: post.categories,
    categoryName: '',
    onlyVideo: isSingleVideoContent(post.content.rendered),
  } as FeedItem;
}

export function toPostDetail(
  post: IPost,
  categories: ICategory[],
  tags: ITag[]
): PostDetailResponse {
  const tagNames = post.tags
    .map((tagId) => tags.find((t) => t.id === tagId)?.name)
    .filter((name): name is string => name != null);

  return {
    id: post.id,
    slug: post.slug,
    title: post.title.rendered,
    resume: post.excerpt.rendered,
    readingTime: post.acf.reading_time,
    date: String(post.date),
    author: getAuthor(post),
    image: getFeaturedImageUrl(post),
    content: post.content.rendered,
    tags: tagNames,
    categoryName: categories[0]?.name ?? '',
    onlyVideo: isSingleVideoContent(post.content.rendered),
  };
}

