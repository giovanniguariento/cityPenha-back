import { createTtlCache, CACHE_TTL_MS } from '../helpers/cache.helper';
import type { WordPressUserResponse } from '../types';
import type { ICategory } from '../models/category.interface';
import type { IPost } from '../models/post.interface';
import type { ITag } from '../models/tag.interface';

const credentials = Buffer.from(
  `${process.env.ENV_API_WORDPRESS_ADMIN_USER}:${process.env.ENV_API_WORDPRESS_ADMIN_PASSWORD}`
).toString('base64');

import { fetchWithTimeout } from '../helpers/fetch.helper';

export class WordpressService {
  private cache = {
    posts: createTtlCache<IPost[]>(CACHE_TTL_MS.HOME),
    categories: createTtlCache<ICategory[]>(CACHE_TTL_MS.CATEGORIES),
    ads: createTtlCache<IPost[]>(CACHE_TTL_MS.ADS),
    post: createTtlCache<IPost>(CACHE_TTL_MS.POST),
    categoriesById: createTtlCache<ICategory[]>(CACHE_TTL_MS.POST),
    tagsById: createTtlCache<ITag[]>(CACHE_TTL_MS.POST),
    ad: createTtlCache<IPost>(CACHE_TTL_MS.POST),
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

  public async getTypePostBySearch(slug: string): Promise<IPost[]> {
    const response = await fetchWithTimeout(
      `${this.baseUrl()}/search?search=${encodeURIComponent(slug)}&_embed`
    );
    if (!response.ok) {
      throw new Error(`Erro ao pesquisar post: ${response.statusText}`);
    }
    return response.json();
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
   * Fetch the N most recent categories (by id desc) and for each category
   * fetch the M most recent posts belonging to that category.
   *
   * Returns an object with `categories` (ICategory[]) and `postsByCategory`
   * which maps category id -> IPost[] (up to postsPerCategory items).
   */
  public async getRecentPostsForTopCategories(
    limitCategories = 5,
    postsPerCategory = 10
  ): Promise<{ categories: ICategory[]; postsByCategory: Record<number, IPost[]> }> {
    // Get all categories (cached) then pick the most recent by id
    const allCategories = await this.getCategories();
    const topCategories = allCategories
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
