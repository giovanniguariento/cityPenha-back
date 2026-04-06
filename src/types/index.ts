/**
 * Shared types for API requests, responses, and view models.
 */

import type { IPost } from '../models/post.interface';
import type { ICategory } from '../models/category.interface';

/** Author display info used in feed and post responses */
export interface Author {
  name: string;
  avatarUrl: string;
}

/** Request body for POST /user/signup (requires Authorization: Bearer Firebase ID token). */
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
  viewed?: boolean;
  /** Present on GET /discovery `trendingTopics` — post publish time, PT-BR relative (e.g. "2 horas atrás"). */
  publishedAtRelative?: string;
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
  /** Total de curtidas (pasta fixa `curtidas` de todos os usuários). */
  likesCount: number;
  /** Presente quando o cliente envia Bearer token de usuário registrado. */
  liked?: boolean;
  /** IDs das pastas do usuário em que o post está (inclui `curtidas` e `Salvos` se aplicável). */
  savedFolderIds?: string[];
}

/** Campos do post vindos do WordPress (antes de likes/salvamentos). */
export type PostDetailBase = Omit<PostDetailResponse, 'likesCount' | 'liked' | 'savedFolderIds'>;

/** Item em GET /user/me/folders — pasta + capa do último post (curtido/salvo) nessa pasta. */
export interface PostFolderListItem {
  id: string;
  userId: string;
  name: string;
  internalKey: string | null;
  createdAt: string | Date;
  /** URL da imagem de destaque do item mais recente na pasta; `null` se vazia ou sem mídia. */
  coverImageUrl: string | null;
  /** ID WordPress do item mais recente (por `createdAt` em `favorites`). */
  lastWordpressPostId: number | null;
  /** Quantidade de posts salvos/curtidos nesta pasta. */
  itemCount: number;
}

/** Item em GET /user/me/folders/:folderId/posts — payload WordPress + categorias resolvidas. */
export interface FolderSavedPostItem {
  wordpressPostId: number;
  /** Objeto bruto do REST (`/posts` ou `/ads`), inclui `categories` como IDs. */
  post: IPost;
  /** Objetos de categoria na ordem dos IDs em `post.categories`. */
  categories: ICategory[];
  /** URL da imagem de destaque (`_embedded`), igual `FeedItem.image` na home. */
  image: string;
}

/** WordPress REST API user creation response */
export interface WordPressUserResponse {
  id: number;
  name?: string;
  slug?: string;
  [key: string]: unknown;
}

/** Dates (YYYY-MM-DD) when the user read at least one post. Returned in GET /user/:id and after recording a read. */
export type DaysWithReads = string[];

/** Response of GET /user/:id/frequency */
export interface UserFrequencyResponse {
  daysWithReads: DaysWithReads;
  today: string; // YYYY-MM-DD
}

/** Mission with user progress — usado na lista de missões (getInfo e recordRead). */
export interface MissionWithProgress {
  id: string;
  key: string;
  title: string;
  description: string | null;
  target: number;
  coinReward: number;
  xpReward: number;
  progress: number;
  completed: boolean;
  completedAt: string | null; // ISO date
}

/** User level info returned in user endpoints. */
export interface UserLevel {
  levelNumber: number;
  minXp: number;
  minCompletedMissions: number;
}

/** Item in GET /discovery — `topics` (WordPress categories + post count). */
export interface DiscoveryTopicCategory {
  id: number;
  name: string;
  slug: string;
  newsCount: number;
  /** Featured image URL of the most recently published post in this category (empty if none). */
  latestPostImageUrl: string;
}

/** Item in GET /discovery — `popularAuthors`. */
export interface DiscoveryPopularAuthor {
  wordpressUserId: number;
  name: string;
  avatarUrl: string | null;
  totalLikes: number;
}

/** Payload of GET /discovery `data`. */
export interface DiscoveryResponse {
  newExperiences: unknown[];
  editorsChoice: unknown[];
  topics: DiscoveryTopicCategory[];
  worldNews: FeedItem[];
  trendingTopics: FeedItem[];
  popularAuthors: DiscoveryPopularAuthor[];
}

export type { ApiSuccessBody, ApiErrorBody, ApiErrorCode } from './api';
