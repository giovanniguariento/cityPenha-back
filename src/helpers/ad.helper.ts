import { ETypePost, type IPost } from '../models/post.interface';

/**
 * Insert ads into the posts array after every N content posts.
 * - Counts only actual content posts (ETypePost.POST) when deciding placement.
 * - Rotates through the provided ads array.
 */
/**
 * Insert ads into the posts array after every N content posts.
 * - Counts only actual content posts (ETypePost.POST) when deciding placement.
 * - Rotates through the provided ads array.
 * - Supports a variable interval between min and max (inclusive). If max is omitted,
 *   a fixed interval is used.
 * - Optionally assigns a category id to cloned ads for category-specific lists.
 */
export function insertAdsIntoPosts(
  posts: IPost[],
  ads: IPost[] | undefined,
  intervalMin = 4,
  intervalMax?: number,
  assignCategoryId?: number
): IPost[] {
  if (!posts || posts.length === 0) return [];
  if (!ads || ads.length === 0) return posts.slice();

  const result: IPost[] = [];
  let adIndex = 0;
  let contentSinceLastAd = 0;

  // normalize interval range
  const min = Math.max(1, Math.floor(intervalMin));
  const max = intervalMax && intervalMax >= min ? Math.floor(intervalMax) : min;

  // helper to pick next interval (random between min and max inclusive)
  const pickInterval = () => (min === max ? min : Math.floor(Math.random() * (max - min + 1)) + min);
  let currentInterval = pickInterval();

  for (const post of posts) {
    result.push(post);
    if (post.type === ETypePost.POST) {
      contentSinceLastAd++;
      if (contentSinceLastAd >= currentInterval) {
        const ad = ads[adIndex];
        if (ad) {
          // optionally clone ad and assign category for category-specific lists
          const adToInsert = assignCategoryId ? { ...ad, categories: [assignCategoryId] } : ad;
          result.push(adToInsert);
          adIndex = (adIndex + 1) % ads.length;
          contentSinceLastAd = 0;
          currentInterval = pickInterval();
        }
      }
    }
  }

  return result;
}

