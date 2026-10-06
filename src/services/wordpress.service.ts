import { createTtlCache, CACHE_TTL_MS } from '../helpers/cache.helper';
import type { ICategory } from '../models/category.interface';
import { ETypePost, type IFeaturedMedia, type IPost } from '../models/post.interface';
import type { ITag } from '../models/tag.interface';
import { getFeaturedImageUrl } from '../helpers/post.helper';
import {
  generateWordpressPassword,
} from '../helpers/wordpressCredentials.helper';
import { publishPressAuthorsService } from './publishPressAuthors.service';
import { prisma } from '../lib/prisma';

const credentials = Buffer.from(
  `${process.env.ENV_API_WORDPRESS_ADMIN_USER}:${process.env.ENV_API_WORDPRESS_ADMIN_PASSWORD}`
).toString('base64');

import { fetchWithTimeout } from '../helpers/fetch.helper';
import { logger } from '../lib/logger';

export type ResolvedPostBySlug = { id: number; kind: 'post' | 'ad' };

export type WordPressMedia = { id: number; sourceUrl: string };

/** Optional Basic auth override (defaults to ENV admin credentials). */
export type WordpressBasicAuth = { username: string; password: string };

export type WordPressCreatedUser = {
  id: number;
  username: string;
  password: string;
};

export type WordpressExistingUserCode = 'existing_user_email' | 'existing_user_login';

/** Thrown when WP REST refuses create because email/login already exists. */
export class WordpressExistingUserError extends Error {
  readonly code: WordpressExistingUserCode;

  constructor(code: WordpressExistingUserCode, message?: string) {
    super(message ?? `WordPress user already exists (${code})`);
    this.name = 'WordpressExistingUserError';
    this.code = code;
  }
}

function isWordpressExistingUserCode(code: unknown): code is WordpressExistingUserCode {
  return code === 'existing_user_email' || code === 'existing_user_login';
}

function toWordpressUserId(raw: unknown): number | null {
  if (typeof raw === 'bigint') {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function basicAuthHeader(auth?: WordpressBasicAuth): string {
  if (auth?.username && auth?.password) {
    return Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
  }
  return credentials;
}

const AD_TYPE_ALIASES = new Set(['ad', 'ads', 'anuncio', 'anúncio']);

function normalizeAdPost(post: IPost): IPost {
  return { ...post, type: ETypePost.AD, subtype: ETypePost.AD };
}

function normalizePostsFromAdsEndpoint(data: IPost[]): IPost[] {
  return data.map((p) =>
    AD_TYPE_ALIASES.has(String(p.type).toLowerCase()) ? normalizeAdPost(p) : p
  );
}

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
    /** `latestInfo:${categoryId}` → newest post featured image URL + total posts (X-WP-Total) */
    categoryLatestInfo: createTtlCache<{ imageUrl: string | null; total: number }>(
      CACHE_TTL_MS.CATEGORIES
    ),
    /** `catPaged:${categoryId}:${page}:${perPage}` → `X-WP-TotalPages` header value */
    categoryPagedTotalPages: createTtlCache<number>(CACHE_TTL_MS.HOME),
    /** `catPaged:${categoryId}:${page}:${perPage}` → `X-WP-Total` header value */
    categoryPagedTotal: createTtlCache<number>(CACHE_TTL_MS.HOME),
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
   * WordPress REST search across published posts (`search` query param).
   */
  public async searchPosts(q: string, limit: number): Promise<IPost[]> {
    const trimmed = q.trim();
    if (!trimmed || limit <= 0) return [];
    const perPage = Math.min(Math.max(1, limit), 100);
    const encoded = encodeURIComponent(trimmed);
    const response = await fetchWithTimeout(
      `${this.baseUrl()}/posts?search=${encoded}&per_page=${perPage}&_embed=wp:featuredmedia`
    );
    if (!response.ok) {
      throw new Error(`Erro ao pesquisar posts: ${response.statusText}`);
    }
    const data = (await response.json()) as IPost[];
    return data.filter((p) => p.type === ETypePost.POST);
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
   * Paginated posts for a single category (WordPress REST `page`/`per_page`).
   * Returns the (content-only) posts for the requested page plus `totalPages`
   * from the `X-WP-TotalPages` response header (used to compute "has more").
   */
  public async getPostsByCategoryPaged(
    categoryId: number,
    page: number,
    perPage: number
  ): Promise<{ posts: IPost[]; totalPages: number; total: number }> {
    if (categoryId <= 0 || page <= 0 || perPage <= 0) {
      return { posts: [], totalPages: 0, total: 0 };
    }
    const safePerPage = Math.min(perPage, 100);
    const key = `catPaged:${categoryId}:${page}:${safePerPage}`;
    const cached = this.cache.posts.get(key);
    if (cached) {
      const totalPagesHeader = this.cache.categoryPagedTotalPages.get(key) ?? 0;
      const totalHeader = this.cache.categoryPagedTotal.get(key) ?? 0;
      return { posts: cached as IPost[], totalPages: totalPagesHeader, total: totalHeader };
    }
    const response = await fetchWithTimeout(
      `${this.baseUrl()}/posts?categories=${categoryId}&per_page=${safePerPage}&page=${page}&_embed=wp:featuredmedia`
    );
    // WordPress returns 400 when `page` is beyond the last page — treat as empty.
    if (response.status === 400) {
      return { posts: [], totalPages: 0, total: 0 };
    }
    if (!response.ok) {
      throw new Error(`Erro ao buscar posts paginados por categoria: ${response.statusText}`);
    }
    const totalPagesRaw = response.headers.get('X-WP-TotalPages');
    const totalPages = totalPagesRaw != null ? Number(totalPagesRaw) || 0 : 0;
    const totalRaw = response.headers.get('X-WP-Total');
    const total = totalRaw != null ? Number(totalRaw) || 0 : 0;
    const data = (await response.json()) as IPost[];
    const posts = data.filter((p) => p.type === ETypePost.POST);
    this.cache.posts.set(key, posts);
    this.cache.categoryPagedTotalPages.set(key, totalPages);
    this.cache.categoryPagedTotal.set(key, total);
    return { posts, totalPages, total };
  }

  /**
   * Featured image URL + total post count for a category, from a single REST call
   * (`per_page=1`, newest first). The count comes from the `X-WP-Total` header, so it
   * reflects the real number of posts in the topic without an extra request.
   */
  public async getLatestPostInfoForCategory(
    categoryId: number
  ): Promise<{ imageUrl: string | null; total: number }> {
    const key = `latestInfo:${categoryId}`;
    const cached = this.cache.categoryLatestInfo.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const response = await fetchWithTimeout(
      `${this.baseUrl()}/posts?categories=${categoryId}&per_page=1&orderby=date&order=desc&_embed=wp:featuredmedia`
    );
    if (!response.ok) {
      const fallback = { imageUrl: null, total: 0 };
      this.cache.categoryLatestInfo.set(key, fallback);
      return fallback;
    }

    const totalRaw = response.headers.get('X-WP-Total');
    const total = totalRaw != null ? Number(totalRaw) || 0 : 0;
    const data = (await response.json()) as IPost[];
    if (data.length === 0) {
      const empty = { imageUrl: null, total };
      this.cache.categoryLatestInfo.set(key, empty);
      return empty;
    }
    const post = data.find((p) => p.type === ETypePost.POST) ?? data[0];
    const url = getFeaturedImageUrl(post);
    const result = { imageUrl: url || null, total };
    this.cache.categoryLatestInfo.set(key, result);
    return result;
  }

  /**
   * Featured image URL of the most recent post in a category (REST: newest first, `per_page=1`).
   */
  public async getLatestPostFeaturedImageUrlForCategory(
    categoryId: number
  ): Promise<string | null> {
    return (await this.getLatestPostInfoForCategory(categoryId)).imageUrl;
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
    const data = normalizePostsFromAdsEndpoint((await response.json()) as IPost[]);
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
    const data = normalizeAdPost((await response.json()) as IPost);
    this.cache.ad.set(key, data);
    return data;
  }

  /**
   * Looks up a WP user by email via `wp_users` (case-insensitive).
   * Avoids REST GET /users, which is blocked for unauthenticated clients by the mu-plugin.
   */
  async findUserByEmail(email: string): Promise<{ id: number; username: string } | null> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return null;

    // Prefer Prisma model (typed ID) — MySQL ci collation usually matches case-insensitively.
    const row = await prisma.wp_users.findFirst({
      where: { user_email: normalized },
      select: { ID: true, user_login: true },
    });
    if (row) {
      const id = toWordpressUserId(row.ID);
      if (id != null) {
        return { id, username: row.user_login };
      }
    }

    // Fallback for mixed-case emails stored in WP (alias columns so driver casing cannot break ID).
    const rows = await prisma.$queryRaw<Array<{ id: bigint | number | string; user_login: string }>>`
      SELECT ID AS id, user_login FROM wp_users WHERE LOWER(user_email) = ${normalized} LIMIT 1
    `;
    if (rows.length === 0) return null;
    const id = toWordpressUserId(rows[0].id);
    if (id == null) {
      logger.warn(
        { email: normalized, rawId: rows[0].id },
        'wp_users row found by email but ID is invalid'
      );
      return null;
    }
    return { id, username: rows[0].user_login };
  }

  /**
   * Authenticated REST lookup by email (admin Basic auth). Used when DB row is missing or
   * REST cannot resolve the DB id (keeps adopt/create aligned with the live WP instance).
   */
  async findUserByEmailViaRest(email: string): Promise<{ id: number; username: string } | null> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return null;
    const q = encodeURIComponent(normalized);
    const response = await fetchWithTimeout(
      `${this.baseUrl()}/users?search=${q}&per_page=100&context=edit`,
      {
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      }
    );
    if (!response.ok) {
      logger.warn(
        { status: response.status, email: normalized },
        'Failed to search WordPress users by email via REST'
      );
      return null;
    }
    const users = (await response.json()) as Array<{
      id: number;
      email?: string;
      slug?: string;
      username?: string;
    }>;
    const match = users.find((u) => (u.email ?? '').toLowerCase() === normalized);
    if (!match) return null;
    const id = toWordpressUserId(match.id);
    if (id == null) return null;
    return { id, username: match.username || match.slug || String(id) };
  }

  /**
   * Removes a WP user row (+ usermeta) from the shared DB when REST cannot see it.
   * Used to unblock signup when an orphan blocks `existing_user_email` but is not adoptable via REST.
   */
  async purgeWordpressUserLocal(wpUserId: number): Promise<void> {
    if (!Number.isFinite(wpUserId) || wpUserId <= 0) return;
    try {
      await prisma.wp_usermeta.deleteMany({
        where: { user_id: BigInt(wpUserId) },
      });
      await prisma.wp_users.delete({
        where: { ID: BigInt(wpUserId) },
      });
      logger.warn({ wpUserId }, 'Purged local WordPress user orphan from database');
    } catch (err) {
      logger.warn({ err, wpUserId }, 'Failed to purge local WordPress user orphan');
    }
  }

  /**
   * Best-effort delete of a WP user (used to compensate failed signup after WP create).
   * Does not throw — logs and returns on failure.
   */
  async deleteUser(wpUserId: number): Promise<void> {
    if (!Number.isFinite(wpUserId) || wpUserId <= 0) return;
    try {
      const response = await fetchWithTimeout(
        `${this.baseUrl()}/users/${wpUserId}?force=true&reassign=0`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Basic ${credentials}`,
          },
        }
      );
      if (!response.ok && response.status !== 404) {
        const body = await response.text();
        logger.warn(
          { wpUserId, status: response.status, body: body.slice(0, 200) },
          'Failed to delete WordPress user'
        );
      }
    } catch (err) {
      logger.warn({ err, wpUserId }, 'Failed to delete WordPress user');
    }
  }

  /**
   * Idempotent PublishPress Authors setup + optional default avatar attachment.
   * Safe to call for both newly created and adopted (orphan) WP users.
   */
  async provisionAuthor(input: {
    wordpressUserId: number;
    displayName: string;
    email: string;
    defaultAvatarAttachmentId?: number;
  }): Promise<void> {
    const { wordpressUserId, displayName, email, defaultAvatarAttachmentId } = input;

    await publishPressAuthorsService.ensureAuthorProfile({
      wordpressUserId,
      displayName,
      email,
    });
    await publishPressAuthorsService.ensureEditOwnProfileCapability(wordpressUserId);

    if (defaultAvatarAttachmentId != null) {
      await publishPressAuthorsService.setAuthorAvatarAttachment(
        wordpressUserId,
        defaultAvatarAttachmentId
      );
    }
  }

  /**
   * Creates a WP user via REST (`POST /users`) only — does not provision PublishPress.
   * Callers must run `provisionAuthor` afterwards (and compensate with `deleteUser` on failure).
   * When `name` is provided it is sent as WP `name` so `display_name` is not the auto login.
   * @throws {WordpressExistingUserError} when email/login already exists in WP
   */
  async createUser(input: {
    email: string;
    name?: string;
  }): Promise<WordPressCreatedUser> {
    const { email, name } = input;
    const username = email.split('@')[0] + '_' + Math.floor(Math.random() * 1000);
    const password = generateWordpressPassword();
    const newUser: Record<string, unknown> = {
      username,
      email,
      password,
      roles: ['author'],
    };
    if (name) {
      newUser.name = name;
    }

    const response = await fetchWithTimeout(`${this.baseUrl()}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify(newUser),
    });

    if (!response.ok) {
      const bodyText = await response.text();
      let code: unknown;
      try {
        code = (JSON.parse(bodyText) as { code?: unknown }).code;
      } catch {
        // non-JSON error body
      }
      if (isWordpressExistingUserCode(code)) {
        throw new WordpressExistingUserError(code, bodyText);
      }
      throw new Error(`Erro ao criar user: ${response.statusText} ${bodyText}`);
    }

    const data = (await response.json()) as { id: number };
    return { id: data.id, username, password };
  }

  /**
   * Adopts an existing WP user (orphan): resets password so we can store credentials.
   * Verifies the user is visible to REST first; otherwise purge local orphan and recreate.
   * @returns `createdNow: true` when the user had to be recreated after a local purge
   */
  async adoptUser(input: {
    wordpressUserId: number;
    username: string;
    email: string;
    name?: string;
  }): Promise<WordPressCreatedUser & { createdNow: boolean }> {
    const { wordpressUserId, username, email, name } = input;
    if (!Number.isFinite(wordpressUserId) || wordpressUserId <= 0) {
      throw new Error(`Invalid WordPress user id for adopt: ${wordpressUserId}`);
    }

    let targetId = wordpressUserId;
    let targetUsername = username;

    if (!(await this.userExists(targetId))) {
      const viaRest = await this.findUserByEmailViaRest(email);
      if (viaRest) {
        targetId = viaRest.id;
        targetUsername = viaRest.username;
      } else {
        // DB has the email (blocks create) but REST cannot update — remove local orphan and create fresh.
        logger.warn(
          { wordpressUserId, email },
          'WordPress user not visible via REST; purging local orphan and recreating'
        );
        await this.purgeWordpressUserLocal(wordpressUserId);
        const created = await this.createUser({ email, name });
        return { ...created, createdNow: true };
      }
    }

    const password = generateWordpressPassword();
    await this.updateUserPassword(targetId, password);
    return { id: targetId, username: targetUsername, password, createdNow: false };
  }

  async updateUserPassword(wpUserId: number, password: string): Promise<void> {
    if (!Number.isFinite(wpUserId) || wpUserId <= 0) {
      throw new Error(`Invalid WordPress user id for password update: ${wpUserId}`);
    }
    const response = await fetchWithTimeout(`${this.baseUrl()}/users/${wpUserId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify({ password }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Erro ao atualizar senha do user: ${response.statusText} (${response.status}) ${body.slice(0, 200)}`
      );
    }
  }

  /**
   * Updates WP `display_name` so `_embedded.author[].name` (and PublishPress
   * mapped authors) reflect the app profile name.
   * Writes DB directly (authoritative) and mirrors via REST when possible.
   */
  async updateUserDisplayName(wpUserId: number, name: string): Promise<void> {
    if (!Number.isFinite(wpUserId) || wpUserId <= 0) {
      throw new Error(`Invalid WordPress user id for display name update: ${wpUserId}`);
    }
    const trimmed = name.trim().slice(0, 250);
    if (!trimmed) {
      throw new Error('Display name cannot be empty');
    }

    const updated = await prisma.wp_users.updateMany({
      where: { ID: BigInt(wpUserId) },
      data: { display_name: trimmed },
    });
    if (updated.count === 0) {
      throw new Error(`WordPress user ${wpUserId} not found for display name update`);
    }

    // Keep nickname meta in sync (best-effort; REST may use application password).
    try {
      const response = await fetchWithTimeout(`${this.baseUrl()}/users/${wpUserId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${credentials}`,
        },
        body: JSON.stringify({ name: trimmed, nickname: trimmed }),
      });
      if (!response.ok) {
        const body = await response.text();
        logger.warn(
          { wpUserId, status: response.status, body: body.slice(0, 200) },
          'WP REST display name mirror failed; DB display_name was updated'
        );
      }
    } catch (err) {
      logger.warn({ err, wpUserId }, 'WP REST display name mirror errored; DB display_name was updated');
    }
  }

  /**
   * Uploads a binary image to the WordPress Media Library (`POST /media`).
   * When `authorId` is set, reassigns the attachment author to that WP user so
   * later ownership checks (e.g. delete-on-replace) can distinguish it from the
   * shared default avatar.
   */
  async uploadMedia(input: {
    buffer: Buffer;
    filename: string;
    mimeType: string;
    authorId?: number;
    auth?: WordpressBasicAuth;
  }): Promise<WordPressMedia> {
    const { buffer, filename, mimeType, authorId, auth } = input;
    const authorization = `Basic ${basicAuthHeader(auth)}`;

    const response = await fetchWithTimeout(`${this.baseUrl()}/media`, {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        Authorization: authorization,
      },
      body: new Uint8Array(buffer),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Erro ao enviar mídia: ${response.statusText} ${body}`);
    }

    const data = (await response.json()) as { id: number; source_url: string };

    if (authorId != null && Number.isFinite(authorId) && authorId > 0) {
      await this.updateMediaAuthor(data.id, authorId, auth);
    }

    return { id: data.id, sourceUrl: data.source_url };
  }

  private async updateMediaAuthor(
    attachmentId: number,
    authorId: number,
    auth?: WordpressBasicAuth
  ): Promise<void> {
    const response = await fetchWithTimeout(`${this.baseUrl()}/media/${attachmentId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${basicAuthHeader(auth)}`,
      },
      body: JSON.stringify({ author: authorId }),
    });

    if (!response.ok) {
      logger.warn(
        { attachmentId, authorId, status: response.status },
        'Failed to set WordPress media author'
      );
    }
  }

  /** Best-effort deletion of a media attachment (`DELETE /media/:id?force=true`). */
  async deleteMedia(attachmentId: number, auth?: WordpressBasicAuth): Promise<void> {
    if (!Number.isFinite(attachmentId) || attachmentId <= 0) {
      return;
    }
    const response = await fetchWithTimeout(`${this.baseUrl()}/media/${attachmentId}?force=true`, {
      method: 'DELETE',
      headers: {
        Authorization: `Basic ${basicAuthHeader(auth)}`,
      },
    });
    if (!response.ok) {
      logger.warn(
        { attachmentId, status: response.status },
        'Failed to delete WordPress media'
      );
    }
  }

  /**
   * Creates a published WordPress post via REST (`POST /posts`).
   * Prefer author Basic auth without forcing `author` (WP assigns the authenticated user).
   * Admin auth may set `author` when creating on behalf of another user.
   */
  async createPost(input: {
    title: string;
    content: string;
    excerpt: string;
    author?: number;
    categories: number[];
    /** WP attachment id used as post featured image (feed card preview). */
    featuredMedia?: number;
    auth?: WordpressBasicAuth;
  }): Promise<{ id: number; slug: string }> {
    const body: Record<string, unknown> = {
      title: input.title,
      content: input.content,
      // Object form ensures WP stores post_excerpt reliably via REST.
      excerpt: { raw: input.excerpt ?? '' },
      status: 'publish',
      categories: input.categories,
    };
    if (input.author != null && Number.isFinite(input.author) && input.author > 0) {
      body.author = input.author;
    }
    if (
      input.featuredMedia != null &&
      Number.isFinite(input.featuredMedia) &&
      input.featuredMedia > 0
    ) {
      body.featured_media = input.featuredMedia;
    }

    const response = await fetchWithTimeout(`${this.baseUrl()}/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${basicAuthHeader(input.auth)}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const resBody = await response.text();
      throw new Error(`Erro ao criar post: ${response.statusText} ${resBody}`);
    }

    const data = (await response.json()) as {
      id: number;
      slug: string;
      excerpt?: { raw?: string; rendered?: string };
    };
    if (input.excerpt?.trim() && !data.excerpt?.raw?.trim() && !data.excerpt?.rendered?.trim()) {
      logger.warn(
        { postId: data.id, sentLen: input.excerpt.length },
        'WordPress createPost returned empty excerpt after non-empty send; patching'
      );
      await this.patchPostExcerpt(data.id, input.excerpt, input.auth);
    }
    this.invalidatePostCaches(data.id);
    return { id: data.id, slug: data.slug };
  }

  /** PATCH excerpt when create somehow drops it. */
  private async patchPostExcerpt(
    postId: number,
    excerpt: string,
    auth?: WordpressBasicAuth
  ): Promise<void> {
    const response = await fetchWithTimeout(`${this.baseUrl()}/posts/${postId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${basicAuthHeader(auth)}`,
      },
      body: JSON.stringify({ excerpt: { raw: excerpt } }),
    });
    if (!response.ok) {
      const resBody = await response.text();
      logger.warn(
        { postId, status: response.status, body: resBody.slice(0, 200) },
        'Failed to patch post excerpt'
      );
    }
  }

  /** Returns true if a WP user id exists (REST GET /users/:id). */
  async userExists(wpUserId: number): Promise<boolean> {
    if (!Number.isFinite(wpUserId) || wpUserId <= 0) return false;
    const response = await fetchWithTimeout(`${this.baseUrl()}/users/${wpUserId}`, {
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    });
    return response.ok;
  }

  /**
   * Paginated posts by WordPress author id (authenticated; includes draft/pending).
   * Not cached — author management screens need fresh data after edits/deletes.
   */
  async getPostsByAuthorPaged(
    authorId: number,
    page: number,
    perPage: number,
    auth?: WordpressBasicAuth
  ): Promise<{ posts: WordpressAuthorListPost[]; totalPages: number; total: number }> {
    if (!Number.isFinite(authorId) || authorId <= 0 || page <= 0 || perPage <= 0) {
      return { posts: [], totalPages: 0, total: 0 };
    }
    const safePerPage = Math.min(perPage, 100);
    const params = new URLSearchParams({
      author: String(authorId),
      status: 'publish,pending,draft',
      page: String(page),
      per_page: String(safePerPage),
      _embed: 'wp:featuredmedia,wp:term',
      orderby: 'date',
      order: 'desc',
    });
    const response = await fetchWithTimeout(`${this.baseUrl()}/posts?${params}`, {
      headers: {
        Authorization: `Basic ${basicAuthHeader(auth)}`,
      },
    });
    if (response.status === 400) {
      return { posts: [], totalPages: 0, total: 0 };
    }
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Erro ao buscar posts do autor: ${response.statusText} ${body}`);
    }
    const data = (await response.json()) as WordpressAuthorListPost[];
    const totalPages = Number(response.headers.get('X-WP-TotalPages') ?? 0) || 0;
    const total = Number(response.headers.get('X-WP-Total') ?? 0) || 0;
    return { posts: data, totalPages, total };
  }

  /** Single post with `context=edit` (raw title/content/excerpt). Requires auth. */
  async getPostForEdit(
    postId: number,
    auth?: WordpressBasicAuth
  ): Promise<WordpressEditPost | null> {
    if (!Number.isFinite(postId) || postId <= 0) return null;
    const response = await fetchWithTimeout(
      `${this.baseUrl()}/posts/${postId}?context=edit`,
      {
        headers: {
          Authorization: `Basic ${basicAuthHeader(auth)}`,
        },
      }
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Erro ao buscar post para edição: ${response.statusText} ${body}`);
    }
    return (await response.json()) as WordpressEditPost;
  }

  async updatePost(
    postId: number,
    input: {
      title?: string;
      content?: string;
      excerpt?: string;
      categories?: number[];
    },
    auth?: WordpressBasicAuth
  ): Promise<{ id: number; slug: string }> {
    if (!Number.isFinite(postId) || postId <= 0) {
      throw new Error('Invalid post id');
    }
    const body: Record<string, unknown> = {};
    if (typeof input.title === 'string') body.title = input.title;
    if (typeof input.content === 'string') body.content = input.content;
    if (typeof input.excerpt === 'string') body.excerpt = { raw: input.excerpt };
    if (Array.isArray(input.categories)) body.categories = input.categories;

    const response = await fetchWithTimeout(`${this.baseUrl()}/posts/${postId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${basicAuthHeader(auth)}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const resBody = await response.text();
      throw new Error(`Erro ao atualizar post: ${response.statusText} ${resBody}`);
    }

    const data = (await response.json()) as { id: number; slug: string };
    this.invalidatePostCaches(postId);
    return { id: data.id, slug: data.slug };
  }

  /** Moves a post to the trash (`DELETE /posts/:id` without force). */
  async trashPost(postId: number, auth?: WordpressBasicAuth): Promise<void> {
    if (!Number.isFinite(postId) || postId <= 0) return;
    const response = await fetchWithTimeout(`${this.baseUrl()}/posts/${postId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Basic ${basicAuthHeader(auth)}`,
      },
    });
    if (!response.ok && response.status !== 404) {
      const body = await response.text();
      throw new Error(`Erro ao excluir post: ${response.statusText} ${body}`);
    }
    this.invalidatePostCaches(postId);
  }

  /** Clear feed/detail caches so edits and deletes show up promptly. */
  invalidatePostCaches(postId?: number): void {
    this.cache.posts.clear();
    this.cache.categoryLatestInfo.clear();
    this.cache.categoryPagedTotalPages.clear();
    this.cache.categoryPagedTotal.clear();
    if (postId != null && Number.isFinite(postId)) {
      this.cache.post.delete(`post:${postId}`);
    } else {
      this.cache.post.clear();
    }
  }
}

/** List item from authenticated author query (`_embed` featured media + terms). */
export type WordpressAuthorListPost = {
  id: number;
  slug: string;
  status: string;
  date: string;
  modified: string;
  title: { rendered: string; raw?: string };
  content: { rendered: string; raw?: string };
  excerpt: { rendered: string; raw?: string };
  categories: number[];
  featured_media?: number;
  author: number;
  _embedded?: {
    'wp:featuredmedia'?: { source_url?: string; media_details?: IFeaturedMedia['media_details'] }[];
    'wp:term'?: { id: number; slug: string; taxonomy: string; name: string }[][];
  };
};

/** WordPress REST post with `context=edit` raw fields. */
export type WordpressEditPost = {
  id: number;
  slug: string;
  status: string;
  date: string;
  modified: string;
  author: number;
  categories: number[];
  featured_media: number;
  title: { raw: string; rendered: string };
  content: { raw: string; rendered: string };
  excerpt: { raw: string; rendered: string };
};

/** Shared instance — same cache as all routes (see `services/index.ts`). */
export const wordpressService = new WordpressService();
