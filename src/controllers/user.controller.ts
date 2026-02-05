import { Request, Response, NextFunction } from 'express';
import { WordpressService } from '../services/wordpress.service';
import { UserService } from '../services/user.service';
import { gamification } from '../services';
import type { CreateUserBody } from '../types';

export class UserController {
  constructor(
    private readonly wordpressService: WordpressService,
    private readonly userService: UserService
  ) { }

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
      const completedMissionsCount = await gamification.getCompletedMissionsCount(id);

      res.status(200).json({ success: true, data: { user, completedMissionsCount } });
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
      // Prefer searching by slug (handles AD and POST types). If caller provides `slug` in the body,
      // use the same search/match strategy as `post.controller.get`. Otherwise fallback to fetching by id.
      const { slug } = req.body as { slug?: string };
      let postExists = false;

      if (slug) {
        const searchQuery = slug.replaceAll('-', ' ').slice(0, 60);
        try {
          const searchResults = await this.wordpressService.getTypePostBySearch(searchQuery);
          const found = (searchResults as any[]).find((p) => p._embedded?.self?.[0]?.slug === slug);
          if (found) postExists = true;
        } catch (err) {
          // ignore and fallback to id-based checks below
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

      const result = await gamification.recordReadPost(userId, wordpressPostId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };
}
