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
  /** Optional Firebase photo; when omitted or blank, backend uses WP/PublishPress default or Gravatar. */
  photoUrl?: string;
}

/** Request body for PATCH /user/me — omit a key to leave unchanged; `null` clears nickname/about. */
export interface UpdateUserProfileBody {
  name?: string;
  nickname?: string | null;
  about?: string | null;
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
  categorySlug: string;
  onlyVideo: boolean;
  viewed?: boolean;
  /** Total de views (leituras logadas + visitantes anônimos). Presente em GET /home e /discovery. */
  viewsCount?: number;
  /** Total de comentários (top-level + respostas). Presente em GET /home. */
  commentsCount?: number;
  /**
   * IDs das pastas do usuário que contêm o post (inclui curtidas e Salvos).
   * Presente em GET /home; `[]` se anônimo ou post não salvo.
   */
  savedFolderIds?: string[];
  /** Present on GET /discovery `trendingTopics` — post publish time, PT-BR relative (e.g. "2 horas atrás"). */
  publishedAtRelative?: string;
}

/** Single post detail API response */
export interface PostDetailResponse {
  id: number;
  slug: string;
  /** `"post"` ou `"anuncio"` (enum `ETypePost`). */
  type: string;
  title: string;
  resume: string;
  readingTime: number;
  date: string;
  author: Author;
  image: string;
  content: string;
  tags: string[];
  categoryName: string;
  categorySlug: string;
  onlyVideo: boolean;
  /** Total de curtidas (pasta fixa `curtidas` de todos os usuários). */
  likesCount: number;
  /** Total de views (leituras logadas em read_posts + views anônimas em post_views). */
  viewsCount: number;
  /** Presente quando o cliente envia Bearer token de usuário registrado. */
  liked?: boolean;
  /** Presente quando o cliente envia Bearer token de usuário registrado. */
  viewed?: boolean;
  /** IDs das pastas do usuário em que o post está (inclui `curtidas` e `Salvos` se aplicável). */
  savedFolderIds?: string[];
}

/** Campos do post vindos do WordPress (antes de likes/salvamentos). */
export type PostDetailBase = Omit<
  PostDetailResponse,
  'likesCount' | 'viewsCount' | 'liked' | 'savedFolderIds' | 'viewed'
>;

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
  /** Slug da primeira categoria resolvida (para URL no frontend). */
  categorySlug: string;
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

export type WordpressCredentialsStatus = 'ready' | 'missing';

/** Item retornado pelos endpoints admin de acesso WordPress. */
export interface AdminWordpressAccessItem {
  userId: string;
  email: string;
  name: string;
  createdAt: string;
  wordpressId: number | null;
  wordpressUsername: string | null;
  wordpressPassword: string | null;
  wordpressLoginUrl: string;
  credentialsStatus: WordpressCredentialsStatus;
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

/** Progress snapshot from current level to next level (for UI progress bar). */
export interface UserLevelProgress {
  percentage: number;
  currentLevel: number;
  nextLevel: number | null;
  xp: {
    current: number;
    requiredForNext: number | null;
  };
  missions: {
    current: number;
    requiredForNext: number | null;
  };
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

/** Payload of GET /discovery/search `data`. */
export interface DiscoverySearchResponse {
  posts: FeedItem[];
  topics: DiscoveryTopicCategory[];
  authors: DiscoveryPopularAuthor[];
}

/** Author info em comentários (pode usar nickname). */
export interface CommentAuthor {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** Representação de um comentário na API (top-level ou resposta). */
export interface CommentView {
  id: string;
  content: string;
  author: CommentAuthor;
  /** ISO-8601 */
  createdAt: string;
  /** Tempo relativo em PT-BR, ex.: "2 dias atrás". */
  createdAtRelative: string;
  likeCount: number;
  /** Presente quando a requisição tem Bearer de usuário registrado. */
  liked?: boolean;
  /** Quantidade de respostas diretas (apenas em comentários top-level). */
  replyCount?: number;
  /** `true` quando o viewer autenticado é o autor do comentário. */
  isOwn?: boolean;
}

/** Resposta de POST /post/:id/comments — comentário criado + snapshot de gamificação. */
export interface CreateCommentResponse {
  comment: CommentView;
  missions: unknown[];
  badges: unknown[];
  level: unknown | null;
  user: { id: string; xp: number; coins: number };
  completedMissionsCount: number;
  rewards: unknown[];
}

export type { ApiSuccessBody, ApiErrorBody, ApiErrorCode } from './api';
