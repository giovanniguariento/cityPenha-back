/**
 * Discovery screen (GET /discovery) — defaults and env overrides.
 *
 * DISCOVERY_WORLD_NEWS_CATEGORY_IDS: comma-separated WordPress category IDs (e.g. `3,7,12`).
 * When empty or unset, the app uses WORLD_NEWS_CATEGORY_IDS_DEFAULT (empty = no world news until configured).
 */

function parseIntList(envValue: string | undefined): number[] {
  if (!envValue?.trim()) return [];
  return envValue
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function parsePositiveInt(envValue: string | undefined, fallback: number): number {
  const n = Number(envValue);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Default: none — set DISCOVERY_WORLD_NEWS_CATEGORY_IDS or pass query `worldNewsCategories`. */
export const WORLD_NEWS_CATEGORY_IDS_DEFAULT: number[] = [];

export const WORLD_NEWS_CATEGORY_IDS: number[] =
  parseIntList(process.env.DISCOVERY_WORLD_NEWS_CATEGORY_IDS).length > 0
    ? parseIntList(process.env.DISCOVERY_WORLD_NEWS_CATEGORY_IDS)
    : WORLD_NEWS_CATEGORY_IDS_DEFAULT;

export const DISCOVERY_LIMIT_WORLD_NEWS = parsePositiveInt(
  process.env.DISCOVERY_LIMIT_WORLD_NEWS,
  10
);

export const DISCOVERY_LIMIT_TRENDING = parsePositiveInt(
  process.env.DISCOVERY_LIMIT_TRENDING,
  5
);

export const DISCOVERY_LIMIT_POPULAR_AUTHORS = parsePositiveInt(
  process.env.DISCOVERY_LIMIT_POPULAR_AUTHORS,
  5
);
