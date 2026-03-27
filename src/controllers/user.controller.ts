import { Request, Response, NextFunction } from 'express';
import { WordpressService } from '../services/wordpress.service';
import { UserService } from '../services/user.service';
import { prisma } from '../lib/prisma';
import type { PostFolderService } from '../services/postFolder.service';
import { SYSTEM_FOLDER_KEY_DEFAULT_SAVED, SYSTEM_FOLDER_KEY_LIKES } from '../services/postFolder.service';
import { gamification } from '../services';
import type { CreateUserBody } from '../types';
import type { ICategory } from '../models/category.interface';
import type { IPost } from '../models/post.interface';
import {
  fetchFeaturedImageUrl,
  fetchPostOrAd,
  getFeaturedImageUrl,
  verifyWordpressPostExists,
} from '../helpers/post.helper';

export class UserController {
  constructor(
    private readonly wordpressService: WordpressService,
    private readonly userService: UserService,
    private readonly postFolderService: PostFolderService
  ) {}

  public create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = req.body as Partial<CreateUserBody>;
      const { email, firebaseUid, name, photoUrl } = body;
      if (!email || !firebaseUid || !name || !photoUrl) {
        res.status(400).json({ success: false, message: 'Missing required fields' });
        return;
      }

      const existing = await this.userService.findByFirebaseUid(firebaseUid);
      if (existing) {
        res.status(200).json(existing);
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

      res.status(200).json(user);
    } catch (error) {
      next(error);
    }
  };

  public getInfo = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id?: string };
      if (!id) {
        res.status(400).json({ success: false, message: 'Missing user id' });
        return;
      }

      const user = await this.userService.findById(id);
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
      const [completedMissionsCount, daysWithReads, missions, level] = await Promise.all([
        gamification.getCompletedMissionsCount(id),
        gamification.getDaysWithReads(id),
        gamification.getMissionsWithUserProgress(id),
        gamification.getUserLevel(id),
      ]);

      res.status(200).json({ success: true, data: { user, completedMissionsCount, daysWithReads, missions, level } });
    } catch (error) {
      next(error);
    }
  };

  /** GET /user/:id/frequency — retorna dias em que leu notícia + data de hoje (YYYY-MM-DD). */
  public getFrequency = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id?: string };
      if (!id) {
        res.status(400).json({ success: false, message: 'Missing user id' });
        return;
      }

      const user = await this.userService.findById(id);
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }

      const daysWithReads = await gamification.getDaysWithReads(id);
      const today = new Date().toISOString().slice(0, 10);

      res.status(200).json({ success: true, data: { daysWithReads, today } });
    } catch (error) {
      next(error);
    }
  };

  public recordRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const wordpressPostId = Number(req.params.postId);
      const { userId } = req.body as { userId?: string };
      if (!userId || !wordpressPostId) {
        res.status(400).json({ success: false, message: 'Missing userId or postId' });
        return;
      }
      // Verify the post exists on WordPress before recording.
      // If caller provides `slug`, resolve by slug and require it to match the same WordPress id.
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
        // fallback: try post and ad endpoints by id
        try {
          await this.wordpressService.getPost(wordpressPostId);
          postExists = true;
        } catch (err) {
          try {
            await this.wordpressService.getAd(wordpressPostId);
            postExists = true;
          } catch (err2) {
            postExists = false;
          }
        }
      }

      if (!postExists) {
        res.status(404).json({ success: false, message: 'Post not found' });
        return;
      }

      await this.postFolderService.ensureSystemFoldersForUser(userId);

      const result = await gamification.recordReadPost(userId, wordpressPostId);
      const daysWithReads = result.daysWithReads ?? (await gamification.getDaysWithReads(userId));
      const missions = await gamification.getMissionsWithUserProgress(userId);
      const data = 'user' in result
        ? { user: result.user, completedMissionsCount: result.completedMissionsCount, daysWithReads, missions, level: result.level ?? null }
        : { ...result, daysWithReads, missions };
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  };

  /** GET /user/:id/folders */
  public listFolders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ success: false, message: 'Missing user id' });
        return;
      }
      const user = await this.userService.findById(id);
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
      const [folders, lastByFolder, countByFolder] = await Promise.all([
        this.postFolderService.listFolders(id),
        this.postFolderService.getLastFavoriteWordpressPostIdByFolder(id),
        this.postFolderService.getFavoriteCountByFolder(id),
      ]);
      const uniquePostIds = [
        ...new Set(
          folders
            .map((f) => lastByFolder.get(f.id))
            .filter((pid): pid is number => pid != null)
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
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  };

  /** GET /user/:id/folders/:folderId/posts — posts WordPress completos + `categories` resolvidos (mais recentes primeiro). */
  public listPostsInFolder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, folderId } = req.params;
      if (!id || !folderId) {
        res.status(400).json({ success: false, message: 'Missing user id or folder id' });
        return;
      }
      const user = await this.userService.findById(id);
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
      const result = await this.postFolderService.listWordpressPostIdsInFolder(id, folderId);
      if (!result.ok) {
        res.status(404).json({ success: false, message: 'Folder not found' });
        return;
      }
      const orderedIds = result.wordpressPostIds;
      const resolved = await Promise.all(
        orderedIds.map(async (wordpressPostId) => {
          const post = await fetchPostOrAd(this.wordpressService, wordpressPostId);
          return post ? { wordpressPostId, post } : null;
        })
      );
      const pairs = resolved.filter(
        (x): x is { wordpressPostId: number; post: IPost } => x != null
      );
      const uniqueCatIds = [...new Set(pairs.flatMap((p) => p.post.categories))];
      const categoryList =
        uniqueCatIds.length > 0
          ? await this.wordpressService.getCategoriesById(uniqueCatIds)
          : [];
      const catById = new Map(categoryList.map((c) => [c.id, c]));
      const posts = pairs.map(({ wordpressPostId, post }) => ({
        wordpressPostId,
        post,
        categories: post.categories
          .map((cid) => catById.get(cid))
          .filter((c): c is ICategory => c != null),
        image: getFeaturedImageUrl(post),
      }));
      res.status(200).json({
        success: true,
        data: { folderId, posts },
      });
    } catch (error) {
      next(error);
    }
  };

  /** POST /user/:id/folders — body `{ name }` */
  public createFolder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const { name } = req.body as { name?: string };
      if (!id) {
        res.status(400).json({ success: false, message: 'Missing user id' });
        return;
      }
      const user = await this.userService.findById(id);
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
      if (!name || typeof name !== 'string') {
        res.status(400).json({ success: false, message: 'Missing folder name' });
        return;
      }
      try {
        const folder = await this.postFolderService.createCustomFolder(id, name);
        res.status(201).json({ success: true, data: folder });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Bad request';
        res.status(400).json({ success: false, message: msg });
      }
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /user/:id/folders/:folderId */
  public deleteFolder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, folderId } = req.params;
      if (!id || !folderId) {
        res.status(400).json({ success: false, message: 'Missing user id or folder id' });
        return;
      }
      const user = await this.userService.findById(id);
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
      try {
        const deleted = await this.postFolderService.deleteFolder(id, folderId);
        if (!deleted) {
          res.status(404).json({ success: false, message: 'Folder not found' });
          return;
        }
        res.status(200).json({ success: true, data: { id: deleted.id } });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Bad request';
        res.status(400).json({ success: false, message: msg });
      }
    } catch (error) {
      next(error);
    }
  };

  /** POST /user/:id/folders/:folderId/posts/:wordpressPostId */
  public addPostToFolder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, folderId, wordpressPostId: wpParam } = req.params;
      const wordpressPostId = Number(wpParam);
      if (!id || !folderId || !Number.isFinite(wordpressPostId)) {
        res.status(400).json({ success: false, message: 'Missing or invalid parameters' });
        return;
      }
      const user = await this.userService.findById(id);
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
      const exists = await verifyWordpressPostExists(this.wordpressService, wordpressPostId);
      if (!exists) {
        res.status(404).json({ success: false, message: 'Post not found' });
        return;
      }
      const result = await this.postFolderService.addPostToFolder(id, folderId, wordpressPostId);
      if (!result.ok) {
        res.status(404).json({ success: false, message: 'Folder not found' });
        return;
      }

      const folder = await prisma.postFolder.findFirst({
        where: { id: folderId, userId: id },
        select: { internalKey: true },
      });
      if (folder?.internalKey === SYSTEM_FOLDER_KEY_LIKES) {
        const likeResult = await gamification.syncLikeMissionState(id);
        const missions = await gamification.getMissionsWithUserProgress(id);
        const level = await gamification.getUserLevel(id);
        const base = { folderId, wordpressPostId, missions, level };
        if ('user' in likeResult && likeResult.user) {
          res.status(200).json({
            success: true,
            data: {
              ...base,
              user: likeResult.user,
              completedMissionsCount: likeResult.completedMissionsCount,
            },
          });
          return;
        }
        res.status(200).json({ success: true, data: base });
        return;
      }
      if (folder?.internalKey === SYSTEM_FOLDER_KEY_DEFAULT_SAVED) {
        const saveResult = await gamification.syncSaveMissionState(id);
        const missions = await gamification.getMissionsWithUserProgress(id);
        const level = await gamification.getUserLevel(id);
        const base = { folderId, wordpressPostId, missions, level };
        if ('user' in saveResult && saveResult.user) {
          res.status(200).json({
            success: true,
            data: {
              ...base,
              user: saveResult.user,
              completedMissionsCount: saveResult.completedMissionsCount,
            },
          });
          return;
        }
        res.status(200).json({ success: true, data: base });
        return;
      }

      res.status(200).json({ success: true, data: { folderId, wordpressPostId } });
    } catch (error) {
      next(error);
    }
  };

  /** DELETE /user/:id/folders/:folderId/posts/:wordpressPostId */
  public removePostFromFolder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, folderId, wordpressPostId: wpParam } = req.params;
      const wordpressPostId = Number(wpParam);
      if (!id || !folderId || !Number.isFinite(wordpressPostId)) {
        res.status(400).json({ success: false, message: 'Missing or invalid parameters' });
        return;
      }
      const user = await this.userService.findById(id);
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
      const result = await this.postFolderService.removePostFromFolder(id, folderId, wordpressPostId);
      if (!result.ok) {
        res.status(404).json({ success: false, message: 'Folder not found' });
        return;
      }
      const folder = await prisma.postFolder.findFirst({
        where: { id: folderId, userId: id },
        select: { internalKey: true },
      });
      if (folder?.internalKey === SYSTEM_FOLDER_KEY_LIKES) {
        const likeResult = await gamification.syncLikeMissionState(id);
        const missions = await gamification.getMissionsWithUserProgress(id);
        const level = await gamification.getUserLevel(id);
        const base = { folderId, wordpressPostId, missions, level };
        if ('user' in likeResult && likeResult.user) {
          res.status(200).json({
            success: true,
            data: {
              ...base,
              user: likeResult.user,
              completedMissionsCount: likeResult.completedMissionsCount,
            },
          });
          return;
        }
        res.status(200).json({ success: true, data: base });
        return;
      }
      if (folder?.internalKey === SYSTEM_FOLDER_KEY_DEFAULT_SAVED) {
        const saveResult = await gamification.syncSaveMissionState(id);
        const missions = await gamification.getMissionsWithUserProgress(id);
        const level = await gamification.getUserLevel(id);
        const base = { folderId, wordpressPostId, missions, level };
        if ('user' in saveResult && saveResult.user) {
          res.status(200).json({
            success: true,
            data: {
              ...base,
              user: saveResult.user,
              completedMissionsCount: saveResult.completedMissionsCount,
            },
          });
          return;
        }
        res.status(200).json({ success: true, data: base });
        return;
      }

      res.status(200).json({ success: true, data: { folderId, wordpressPostId } });
    } catch (error) {
      next(error);
    }
  };
}
