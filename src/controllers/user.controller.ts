import type { Request, Response } from 'express';
import { WordpressService } from '../services/wordpress.service';
import { UserService } from '../services/user.service';
import { prisma } from '../lib/prisma';
import type { PostFolderService } from '../services/postFolder.service';
import { SYSTEM_FOLDER_KEY_DEFAULT_SAVED, SYSTEM_FOLDER_KEY_LIKES } from '../services/postFolder.service';
import { gamification } from '../services';
import type { CreateUserBody, UpdateUserProfileBody } from '../types';
import type { ICategory } from '../models/category.interface';
import type { IPost } from '../models/post.interface';
import {
  fetchFeaturedImageUrl,
  fetchPostOrAd,
  getFeaturedImageUrl,
  verifyWordpressPostExists,
} from '../helpers/post.helper';
import { brazilTodayYyyyMmDd } from '../lib/brTime';
import { sendJsonSuccess } from '../lib/apiResponse';
import {
  badRequest,
  forbidden,
  isHttpError,
  notFound,
  unauthorized,
  validationError,
} from '../lib/httpErrors';

export class UserController {
  constructor(
    private readonly wordpressService: WordpressService,
    private readonly userService: UserService,
    private readonly postFolderService: PostFolderService
  ) {}

  public create = async (req: Request, res: Response): Promise<void> => {
    const auth = req.firebaseAuth;
    if (!auth) {
      throw unauthorized('Unauthorized');
    }

    const body = req.body as Partial<CreateUserBody>;
    const { email, firebaseUid, name, photoUrl } = body;
    if (!email || !firebaseUid || !name || !photoUrl) {
      throw validationError('Missing required fields');
    }

    if (firebaseUid !== auth.uid) {
      throw forbidden('firebaseUid does not match token');
    }
    if (auth.email && email.toLowerCase() !== auth.email.toLowerCase()) {
      throw forbidden('email does not match token');
    }

    const existing = await this.userService.findByFirebaseUid(firebaseUid);
    if (existing) {
      sendJsonSuccess(res, existing);
      return;
    }

    const wpUser = await this.wordpressService.createUser(email);
    const user = await this.userService.create({
      email,
      firebaseUid,
      wordpressId: wpUser.id,
      name,
      photoUrl,
    });

    await this.postFolderService.ensureSystemFoldersForUser(user.id);

    sendJsonSuccess(res, user, { status: 201 });
  };

  public getInfo = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) {
      throw unauthorized('Unauthorized');
    }
    const id = user.id;
    const snapshot = await gamification.getUserSummary(id);

    sendJsonSuccess(res, {
      user: { ...user, xp: snapshot.user.xp, coins: snapshot.user.coins },
      completedMissionsCount: snapshot.completedMissionsCount,
      daysWithReads: snapshot.daysWithReads,
      missions: snapshot.missions,
      badges: snapshot.badges,
      level: snapshot.level,
      levelProgress: snapshot.levelProgress,
    });
  };

  /** PATCH /user/me — atualiza name, nickname e/ou about. */
  public updateProfile = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) {
      throw unauthorized('Unauthorized');
    }

    const body = req.body as Partial<UpdateUserProfileBody>;
    const hasName = Object.prototype.hasOwnProperty.call(body, 'name');
    const hasNickname = Object.prototype.hasOwnProperty.call(body, 'nickname');
    const hasAbout = Object.prototype.hasOwnProperty.call(body, 'about');

    if (!hasName && !hasNickname && !hasAbout) {
      throw validationError('No fields to update');
    }

    const data: { name?: string; nickname?: string | null; about?: string | null } = {};

    if (hasName) {
      if (typeof body.name !== 'string') {
        throw validationError('name must be a string');
      }
      const trimmed = body.name.trim();
      if (trimmed.length === 0) {
        throw validationError('name cannot be empty');
      }
      if (trimmed.length > 120) {
        throw validationError('name must be at most 120 characters');
      }
      data.name = trimmed;
    }

    if (hasNickname) {
      if (body.nickname === null) {
        data.nickname = null;
      } else if (typeof body.nickname === 'string') {
        const t = body.nickname.trim();
        if (t.length === 0) {
          data.nickname = null;
        } else if (t.length < 2) {
          throw validationError('nickname must be at least 2 characters when set');
        } else if (t.length > 40) {
          throw validationError('nickname must be at most 40 characters');
        } else {
          data.nickname = t;
        }
      } else {
        throw validationError('nickname must be a string or null');
      }
    }

    if (hasAbout) {
      if (body.about === null) {
        data.about = null;
      } else if (typeof body.about === 'string') {
        if (body.about.length > 2000) {
          throw validationError('about must be at most 2000 characters');
        }
        data.about = body.about;
      } else {
        throw validationError('about must be a string or null');
      }
    }

    const updated = await this.userService.updateProfile(user.id, data);
    sendJsonSuccess(res, updated);
  };

  /** GET /user/me/badges — todas as insígnias ativas com flag `earned` e progresso atual. */
  public listBadges = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) {
      throw unauthorized('Unauthorized');
    }
    const badges = await gamification.getUserBadges(user.id);
    sendJsonSuccess(res, badges);
  };

  /** GET /user/me/frequency — retorna dias em que leu notícia + data de hoje (YYYY-MM-DD). */
  public getFrequency = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) {
      throw unauthorized('Unauthorized');
    }
    const id = user.id;

    const daysWithReads = await gamification.getDaysWithReads(id);
    const today = brazilTodayYyyyMmDd();

    sendJsonSuccess(res, { daysWithReads, today });
  };

  public recordRead = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) {
      throw unauthorized('Unauthorized');
    }
    const userId = user.id;

    const wordpressPostId = Number(req.params.postId);
    if (!Number.isFinite(wordpressPostId)) {
      throw badRequest('Invalid postId');
    }

    const existingRead = await prisma.readPost.findUnique({
      where: { userId_wordpressPostId: { userId, wordpressPostId } },
      select: { id: true },
    });
    if (existingRead) {
      const snapshot = await gamification.notify('manual_recompute', { userId });
      sendJsonSuccess(res, {
        alreadyRead: true,
        user: snapshot.user,
        completedMissionsCount: snapshot.completedMissionsCount,
        daysWithReads: snapshot.daysWithReads,
        missions: snapshot.missions,
        badges: snapshot.badges,
        level: snapshot.level,
        rewards: [],
      });
      return;
    }

    const { slug } = req.body as { slug?: string };
    let postExists = false;

    if (slug) {
      try {
        const resolved = await this.wordpressService.resolvePostBySlug(slug);
        if (resolved?.id === wordpressPostId) postExists = true;
      } catch {
        // fallback to id-based checks below
      }
    }

    if (!postExists) {
      try {
        await this.wordpressService.getPost(wordpressPostId);
        postExists = true;
      } catch {
        try {
          await this.wordpressService.getAd(wordpressPostId);
          postExists = true;
        } catch {
          postExists = false;
        }
      }
    }

    if (!postExists) {
      throw notFound('Post not found');
    }

    await this.postFolderService.ensureSystemFoldersForUser(userId);

    const snapshot = await gamification.notify('read', { userId, wordpressPostId });

    sendJsonSuccess(res, {
      alreadyRead: false,
      user: snapshot.user,
      completedMissionsCount: snapshot.completedMissionsCount,
      daysWithReads: snapshot.daysWithReads,
      missions: snapshot.missions,
      badges: snapshot.badges,
      level: snapshot.level,
      rewards: snapshot.rewards,
    });
  };

  /** GET /user/me/folders */
  public listFolders = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) {
      throw unauthorized('Unauthorized');
    }
    const id = user.id;
    const [folders, lastByFolder, countByFolder] = await Promise.all([
      this.postFolderService.listFolders(id),
      this.postFolderService.getLastFavoriteWordpressPostIdByFolder(id),
      this.postFolderService.getFavoriteCountByFolder(id),
    ]);
    const uniquePostIds = [
      ...new Set(
        folders.map((f) => lastByFolder.get(f.id)).filter((pid): pid is number => pid != null)
      ),
    ];
    const imageByPostId = new Map<number, string | null>();
    await Promise.all(
      uniquePostIds.map(async (pid) => {
        const url = await fetchFeaturedImageUrl(this.wordpressService, pid);
        imageByPostId.set(pid, url);
      })
    );
    const data = folders.map((f) => {
      const lastWordpressPostId = lastByFolder.get(f.id) ?? null;
      const coverImageUrl =
        lastWordpressPostId != null ? imageByPostId.get(lastWordpressPostId) ?? null : null;
      return {
        ...f,
        coverImageUrl,
        lastWordpressPostId,
        itemCount: countByFolder.get(f.id) ?? 0,
      };
    });
    sendJsonSuccess(res, data);
  };

  /** GET /user/me/folders/:folderId/posts — posts WordPress completos + `categories` resolvidos (mais recentes primeiro). */
  public listPostsInFolder = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) {
      throw unauthorized('Unauthorized');
    }
    const id = user.id;
    const { folderId } = req.params;
    if (!folderId) {
      throw validationError('Missing folder id');
    }
    const result = await this.postFolderService.listWordpressPostIdsInFolder(id, folderId);
    if (!result.ok) {
      throw notFound('Folder not found');
    }
    const orderedIds = result.wordpressPostIds;
    const resolved = await Promise.all(
      orderedIds.map(async (wordpressPostId) => {
        const post = await fetchPostOrAd(this.wordpressService, wordpressPostId);
        return post ? { wordpressPostId, post } : null;
      })
    );
    const pairs = resolved.filter((x): x is { wordpressPostId: number; post: IPost } => x != null);
    const uniqueCatIds = [...new Set(pairs.flatMap((p) => p.post.categories))];
    const categoryList =
      uniqueCatIds.length > 0 ? await this.wordpressService.getCategoriesById(uniqueCatIds) : [];
    const catById = new Map(categoryList.map((c) => [c.id, c]));
    const posts = pairs.map(({ wordpressPostId, post }) => ({
      wordpressPostId,
      post,
      categories: post.categories
        .map((cid) => catById.get(cid))
        .filter((c): c is ICategory => c != null),
      image: getFeaturedImageUrl(post),
    }));
    sendJsonSuccess(res, { folderId, posts });
  };

  /** POST /user/me/folders — body `{ name }` */
  public createFolder = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) {
      throw unauthorized('Unauthorized');
    }
    const id = user.id;
    const { name } = req.body as { name?: string };
    if (!name || typeof name !== 'string') {
      throw validationError('Missing folder name');
    }
    try {
      const folder = await this.postFolderService.createCustomFolder(id, name);
      sendJsonSuccess(res, folder, { status: 201 });
    } catch (e) {
      if (isHttpError(e)) throw e;
      throw badRequest(e instanceof Error ? e.message : 'Bad request');
    }
  };

  /** DELETE /user/me/folders/:folderId */
  public deleteFolder = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) {
      throw unauthorized('Unauthorized');
    }
    const id = user.id;
    const { folderId } = req.params;
    if (!folderId) {
      throw validationError('Missing folder id');
    }
    try {
      const deleted = await this.postFolderService.deleteFolder(id, folderId);
      if (!deleted) {
        throw notFound('Folder not found');
      }
      sendJsonSuccess(res, { id: deleted.id });
    } catch (e) {
      if (isHttpError(e)) throw e;
      throw badRequest(e instanceof Error ? e.message : 'Bad request');
    }
  };

  /** POST /user/me/folders/:folderId/posts/:wordpressPostId */
  public addPostToFolder = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) {
      throw unauthorized('Unauthorized');
    }
    const id = user.id;
    const { folderId, wordpressPostId: wpParam } = req.params;
    const wordpressPostId = Number(wpParam);
    if (!folderId || !Number.isFinite(wordpressPostId)) {
      throw validationError('Missing or invalid parameters');
    }
    const exists = await verifyWordpressPostExists(this.wordpressService, wordpressPostId);
    if (!exists) {
      throw notFound('Post not found');
    }
    const result = await this.postFolderService.addPostToFolder(id, folderId, wordpressPostId);
    if (!result.ok) {
      throw notFound('Folder not found');
    }

    const folder = await prisma.postFolder.findFirst({
      where: { id: folderId, userId: id },
      select: { internalKey: true },
    });
    if (folder?.internalKey === SYSTEM_FOLDER_KEY_LIKES) {
      const snapshot = await gamification.notify('like.added', { userId: id, wordpressPostId });
      sendJsonSuccess(res, {
        folderId,
        wordpressPostId,
        user: snapshot.user,
        completedMissionsCount: snapshot.completedMissionsCount,
        missions: snapshot.missions,
        badges: snapshot.badges,
        level: snapshot.level,
        rewards: snapshot.rewards,
      });
      return;
    }
    if (folder?.internalKey === SYSTEM_FOLDER_KEY_DEFAULT_SAVED) {
      const snapshot = await gamification.notify('save.added', { userId: id, wordpressPostId });
      sendJsonSuccess(res, {
        folderId,
        wordpressPostId,
        user: snapshot.user,
        completedMissionsCount: snapshot.completedMissionsCount,
        missions: snapshot.missions,
        badges: snapshot.badges,
        level: snapshot.level,
        rewards: snapshot.rewards,
      });
      return;
    }

    sendJsonSuccess(res, { folderId, wordpressPostId });
  };

  /** DELETE /user/me/folders/:folderId/posts/:wordpressPostId */
  public removePostFromFolder = async (req: Request, res: Response): Promise<void> => {
    const user = req.appUser;
    if (!user) {
      throw unauthorized('Unauthorized');
    }
    const id = user.id;
    const { folderId, wordpressPostId: wpParam } = req.params;
    const wordpressPostId = Number(wpParam);
    if (!folderId || !Number.isFinite(wordpressPostId)) {
      throw validationError('Missing or invalid parameters');
    }
    const result = await this.postFolderService.removePostFromFolder(id, folderId, wordpressPostId);
    if (!result.ok) {
      throw notFound('Folder not found');
    }
    const folder = await prisma.postFolder.findFirst({
      where: { id: folderId, userId: id },
      select: { internalKey: true },
    });
    if (folder?.internalKey === SYSTEM_FOLDER_KEY_LIKES) {
      const snapshot = await gamification.notify('like.removed', { userId: id, wordpressPostId });
      sendJsonSuccess(res, {
        folderId,
        wordpressPostId,
        user: snapshot.user,
        completedMissionsCount: snapshot.completedMissionsCount,
        missions: snapshot.missions,
        badges: snapshot.badges,
        level: snapshot.level,
        rewards: snapshot.rewards,
      });
      return;
    }
    if (folder?.internalKey === SYSTEM_FOLDER_KEY_DEFAULT_SAVED) {
      const snapshot = await gamification.notify('save.removed', { userId: id, wordpressPostId });
      sendJsonSuccess(res, {
        folderId,
        wordpressPostId,
        user: snapshot.user,
        completedMissionsCount: snapshot.completedMissionsCount,
        missions: snapshot.missions,
        badges: snapshot.badges,
        level: snapshot.level,
        rewards: snapshot.rewards,
      });
      return;
    }

    sendJsonSuccess(res, { folderId, wordpressPostId });
  };
}
