/**
 * Shared types for API requests, responses, and view models.
 */

/** Author display info used in feed and post responses */
export interface Author {
  name: string;
  avatarUrl: string;
}

/** Request body for POST /user/signup */
export interface CreateUserBody {
  email: string;
  firebaseUid: string;
  name: string;
  photoUrl: string;
}

/** Single item in the home feed (post or ad) */
export interface FeedItem {
  slug: string;
  id: number;
  title: string;
  type: string;
  author: Author;
  tags: number[];
  readingTime: number;
  image: string;
  categories: number[];
  categoryName: string;
  onlyVideo: boolean;
}

/** Single post detail API response */
export interface PostDetailResponse {
  id: number;
  slug: string;
  title: string;
  resume: string;
  readingTime: number;
  date: string;
  author: Author;
  image: string;
  content: string;
  tags: string[];
  categoryName: string;
  onlyVideo: boolean;
}

/** WordPress REST API user creation response */
export interface WordPressUserResponse {
  id: number;
  name?: string;
  slug?: string;
  [key: string]: unknown;
}
