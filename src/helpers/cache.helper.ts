/**
 * Simple in-memory TTL cache for reducing repeated external API calls.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export interface TtlCache<T> {
  get(key: string): T | undefined;
  set(key: string, data: T): void;
  delete(key: string): boolean;
}

export function createTtlCache<T>(ttlMs: number): TtlCache<T> {
  const store = new Map<string, CacheEntry<T>>();

  return {
    get(key: string): T | undefined {
      const entry = store.get(key);
      if (!entry || Date.now() > entry.expiresAt) {
        if (entry) store.delete(key);
        return undefined;
      }
      return entry.data;
    },
    set(key: string, data: T): void {
      store.set(key, { data, expiresAt: Date.now() + ttlMs });
    },
    delete(key: string): boolean {
      return store.delete(key);
    },
  };
}

export const CACHE_TTL_MS = {
  /** Home feed data: 1 minute */
  HOME: 60 * 1000,
  /** Single post / categories / tags: 2 minutes */
  POST: 2 * 60 * 1000,
  /** Categories list: 5 minutes */
  CATEGORIES: 5 * 60 * 1000,
  /** Ads list: 5 minutes */
  ADS: 5 * 60 * 1000,
};
