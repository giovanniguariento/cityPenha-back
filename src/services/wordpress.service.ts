import { createTtlCache, CACHE_TTL_MS } from '../helpers/cache.helper';
import type { WordPressUserResponse } from '../types';
import type { ICategory } from '../models/category.interface';
import { ETypePost, type IPost } from '../models/post.interface';
import type { ITag } from '../models/tag.interface';
import { getFeaturedImageUrl } from '../helpers/post.helper';

const credentials = Buffer.from(
  `${process.env.ENV_API_WORDPRESS_ADMIN_USER}:${process.env.ENV_API_WORDPRESS_ADMIN_PASSWORD}`
).toString('base64');

import { fetchWithTimeout } from '../helpers/fetch.helper';

export type ResolvedPostBySlug = { id: number; kind: 'post' | 'ad' };

/** Shape of WordPress REST `GET /categories` items (fields used by Discovery). */
export interface WordpressCategoryRest {
  id: number;
  name: string;
  slug: string;
  count: number;
}

export class WordpressService {
  private cache = {
    posts: createTtlCache<IPost[]>(CACHE_TTL_MS.HOME),
    categories: createTtlCache<ICategory[]>(CACHE_TTL_MS.CATEGORIES),
    /** Full category list with `count` / `slug` for GET /discovery — separate key from `categories`. */
    categoriesDiscovery: createTtlCache<WordpressCategoryRest[]>(CACHE_TTL_MS.CATEGORIES),
    ads: createTtlCache<IPost[]>(CACHE_TTL_MS.ADS),
    post: createTtlCache<IPost>(CACHE_TTL_MS.POST),
    categoriesById: createTtlCache<ICategory[]>(CACHE_TTL_MS.POST),
    tagsById: createTtlCache<ITag[]>(CACHE_TTL_MS.POST),
    ad: createTtlCache<IPost>(CACHE_TTL_MS.POST),
    categoryBySlug: createTtlCache<number | null>(CACHE_TTL_MS.CATEGORIES),
    /** `latestImg:${categoryId}` → featured media URL of newest post in that category */
    categoryLatestImage: createTtlCache<string | null>(CACHE_TTL_MS.CATEGORIES),
  };

  private baseUrl(): string {
    return process.env.ENV_API_WORDPRESS ?? '';
  }

  public async getAllPosts(): Promise<IPost[]> {
    const cached = this.cache.posts.get('all');
    if (cached) return cached;
    const response = await fetchWithTimeout(
      `${this.baseUrl()}/posts?_embed=wp:featuredmedia&per_page=100`
    );
    if (!response.ok) {
      throw new Error(`Erro ao buscar posts: ${response.statusText}`);
    }
    const data = await response.json();
    this.cache.posts.set('all', data);
    return data;
  }

  /**
   * Fetch recent content posts limited by `limit`.
   * Uses cache key `recent:<limit>` to avoid repeated heavy fetches.
   */
  public async getRecentContentPosts(limit = 11): Promise<IPost[]> {
    const key = `recent:${limit}`;
    const cached = this.cache.posts.get(key);
    if (cached) return cached;
    const response = await fetchWithTimeout(
      `${this.baseUrl()}/posts?_embed=wp:featuredmedia&per_page=${limit}`
    );
    if (!response.ok) {
      throw new Error(`Erro ao buscar posts recentes: ${response.statusText}`);
    }
    const data = await response.json();
    this.cache.posts.set(key, data);
    return data;
  }

  public async getPost(id: number): Promise<IPost> {
    const key = `post:${id}`;
    const cached = this.cache.post.get(key);
    if (cached) return cached;
    const response = await fetchWithTimeout(
      `${this.baseUrl()}/posts/${id}?_embed=wp:featuredmedia`
    );
    if (!response.ok) {
      throw new Error(`Erro ao buscar post: ${response.statusText}`);
    }
    const data = await response.json();
    this.cache.post.set(key, data);
    return data;
  }

  /**
   * Resolve a WordPress post or ad by exact slug (posts first, then ads).
   * Does not use the global /search endpoint.
   */
  public async resolvePostBySlug(slug: string): Promise<ResolvedPostBySlug | null> {
    const q = encodeURIComponent(slug);
    const postsUrl = `${this.baseUrl()}/posts?slug=${q}&_embed=wp:featuredmedia&per_page=1`;
    const postsResp = await fetchWithTimeout(postsUrl);
    if (!postsResp.ok) {
      throw new Error(`Erro ao buscar post por slug: ${postsResp.statusText}`);
    }
    const postsJson = (await postsResp.json()) as { id: number }[];
    if (postsJson.length > 0) {
      return { id: postsJson[0].id, kind: 'post' };
    }

    const adsUrl = `${this.baseUrl()}/ads?slug=${q}&_embed&per_page=1`;
    const adsResp = await fetchWithTimeout(adsUrl);
    if (!adsResp.ok) {
      throw new Error(`Erro ao buscar anúncio por slug: ${adsResp.statusText}`);
    }
    const adsJson = (await adsResp.json()) as { id: number }[];
    if (adsJson.length > 0) {
      return { id: adsJson[0].id, kind: 'ad' };
    }

    return null;
  }

  public async getCategories(): Promise<ICategory[]> {
    const cached = this.cache.categories.get('all');
    if (cached) return cached;
    const response = await fetchWithTimeout(`${this.baseUrl()}/categories`);
    if (!response.ok) {
      throw new Error(`Erro ao buscar categorias: ${response.statusText}`);
    }
    const data = await response.json();
    this.cache.categories.set('all', data);
    return data;
  }

  /**
   * All categories with REST `count` (posts in term) and `slug`.
   * Paginates `per_page=100` until no further pages (WordPress default page size is too small for “all”).
   */
  public async getCategoriesForDiscovery(): Promise<WordpressCategoryRest[]> {
    const cacheKey = 'all';
    const cached = this.cache.categoriesDiscovery.get(cacheKey);
    if (cached) return cached;
    const perPage = 100;
    const all: WordpressCategoryRest[] = [];
    let page = 1;
    for (;;) {
      const url = `${this.baseUrl()}/categories?per_page=${perPage}&page=${page}`;
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`Erro ao buscar categorias (discovery): ${response.statusText}`);
      }
      const batch = (await response.json()) as WordpressCategoryRest[];
      if (batch.length === 0) break;
      for (const row of batch) {
        all.push({
          id: row.id,
          name: row.name,
          slug: row.slug,
          count: row.count ?? 0,
        });
      }
      if (batch.length < perPage) break;
      page += 1;
    }
    this.cache.categoriesDiscovery.set(cacheKey, all);
    return all;
  }

  /**
   * Posts in any of the given category IDs (WordPress OR semantics on `categories` param).
   */
  public async getPostsByCategoryIds(
    categoryIds: number[],
    limit: number
  ): Promise<IPost[]> {
    if (categoryIds.length === 0 || limit <= 0) return [];
    const key = `worldNews:${categoryIds.sort((a, b) => a - b).join(',')}:${limit}`;
    const cached = this.cache.posts.get(key);
    if (cached) return cached as IPost[];
    const ids = categoryIds.join(',');
    const response = await fetchWithTimeout(
      `${this.baseUrl()}/posts?categories=${ids}&per_page=${limit}&_embed=wp:featuredmedia`
    );
    if (!response.ok) {
      throw new Error(`Erro ao buscar posts por categorias: ${response.statusText}`);
    }
    const data = (await response.json()) as IPost[];
    this.cache.posts.set(key, data);
    return data;
  }

  /**
   * Featured image URL of the most recent post in a category (REST: newest first, `per_page=1`).
   */
  public async getLatestPostFeaturedImageUrlForCategory(
    categoryId: number
  ): Promise<string | null> {
    const key = `latestImg:${categoryId}`;
    const cached = this.cache.categoryLatestImage.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const response = await fetchWithTimeout(
      `${this.baseUrl()}/posts?categories=${categoryId}&per_page=1&orderby=date&order=desc&_embed=wp:featuredmedia`
    );
    if (!response.ok) {
      this.cache.categoryLatestImage.set(key, null);
      return null;
    }
    const data = (await response.json()) as IPost[];
    if (data.length === 0) {
      this.cache.categoryLatestImage.set(key, null);
      return null;
    }
    const post = data.find((p) => p.type === ETypePost.POST) ?? data[0];
    const url = getFeaturedImageUrl(post);
    const result = url || null;
    this.cache.categoryLatestImage.set(key, result);
    return result;
  }

  /** Resolves WordPress category term id from slug, or `null` if missing. */
  public async getCategoryIdBySlug(slug: string): Promise<number | null> {
    const trimmed = slug.trim();
    if (!trimmed) return null;
    const cached = this.cache.categoryBySlug.get(trimmed);
    if (cached !== undefined) return cached;
    const q = encodeURIComponent(trimmed);
    const response = await fetchWithTimeout(`${this.baseUrl()}/categories?slug=${q}&per_page=1`);
    if (!response.ok) {
      throw new Error(`Erro ao buscar categoria por slug: ${response.statusText}`);
    }
    const rows = (await response.json()) as { id: number }[];
    const id = rows.length > 0 ? rows[0].id : null;
    this.cache.categoryBySlug.set(trimmed, id);
    return id;
  }

  /**
   * Fetch the N most recent categories (by id desc) and for each category
   * fetch the M most recent posts belonging to that category.
   *
   * Returns an object with `categories` (ICategory[]) and `postsByCategory`
   * which maps category id -> IPost[] (up to postsPerCategory items).
   */
  public async getRecentPostsForTopCategories(
    limitCategories = 5,
    postsPerCategory = 10,
    /** When set (e.g. from a single `getCategories()` on the caller), avoids a duplicate fetch. */
    allCategories?: ICategory[]
  ): Promise<{ categories: ICategory[]; postsByCategory: Record<number, IPost[]> }> {
    const resolved = allCategories ?? (await this.getCategories());
    const topCategories = resolved
      .slice()
      .sort((a, b) => b.id - a.id)
      .slice(0, limitCategories);

    // Fetch posts for each category in parallel, but reuse cached per-category responses
    const fetches = topCategories.map(async (cat) => {
      const catKey = `cat:${cat.id}:${postsPerCategory}`;
      const catCached = this.cache.posts.get(catKey);
      if (catCached) {
        return { id: cat.id, posts: catCached as IPost[] };
      }
      const resp = await fetchWithTimeout(
        `${this.baseUrl()}/posts?categories=${cat.id}&per_page=${postsPerCategory}&_embed=wp:featuredmedia`
      );
      if (!resp.ok) {
        throw new Error(
          `Erro ao buscar posts da categoria ${cat.id}: ${resp.statusText}`
        );
      }
      const data = (await resp.json()) as IPost[];
      this.cache.posts.set(catKey, data);
      return { id: cat.id, posts: data };
    });

    const results = await Promise.all(fetches);
    const postsByCategory: Record<number, IPost[]> = {};
    for (const r of results) {
      postsByCategory[r.id] = r.posts;
    }

    return { categories: topCategories, postsByCategory };
  }

  public async getCategoriesById(ids: number[]): Promise<ICategory[]> {
    const key = `cat:${ids.join(',')}`;
    const cached = this.cache.categoriesById.get(key);
    if (cached) return cached;
    const response = await fetchWithTimeout(
      `${this.baseUrl()}/categories?include=${ids.join(',')}`
    );
    if (!response.ok) {
      throw new Error(`Erro ao buscar categoria: ${response.statusText}`);
    }
    const data = await response.json();
    this.cache.categoriesById.set(key, data);
    return data;
  }

  public async getTagsById(ids: number[]): Promise<ITag[]> {
    const key = `tags:${ids.join(',')}`;
    const cached = this.cache.tagsById.get(key);
    if (cached) return cached;
    const response = await fetchWithTimeout(
      `${this.baseUrl()}/tags?include=${ids.join(',')}`
    );
    if (!response.ok) {
      throw new Error(`Erro ao buscar tags: ${response.statusText}`);
    }
    const data = await response.json();
    this.cache.tagsById.set(key, data);
    return data;
  }

  public async getAllAds(): Promise<IPost[]> {
    const cached = this.cache.ads.get('all');
    if (cached) return cached;
    const response = await fetchWithTimeout(`${this.baseUrl()}/ads?_embed`);
    if (!response.ok) {
      throw new Error(`Erro ao buscar anuncios: ${response.statusText}`);
    }
    const data = await response.json();
    this.cache.ads.set('all', data);
    return data;
  }

  public async getAd(id: number): Promise<IPost> {
    const key = `ad:${id}`;
    const cached = this.cache.ad.get(key);
    if (cached) return cached;
    const response = await fetchWithTimeout(
      `${this.baseUrl()}/ads/${id}?_embed`
    );
    if (!response.ok) {
      throw new Error(`Erro ao buscar anuncio: ${response.statusText}`);
    }
    const data = await response.json();
    this.cache.ad.set(key, data);
    return data;
  }

  async createUser(email: string): Promise<WordPressUserResponse> {
    const newUser = {
      username: email.split('@')[0] + '_' + Math.floor(Math.random() * 1000),
      email,
      password: Math.random().toString(36),
      roles: ['author'],
    };

    const response = await fetchWithTimeout(`${this.baseUrl()}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify(newUser),
    });

    if (!response.ok) {
      throw new Error(`Erro ao criar user: ${response.statusText}`);
    }

    return response.json();
  }
}

/** Shared instance — same cache as all routes (see `services/index.ts`). */
export const wordpressService = new WordpressService();
