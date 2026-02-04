import { Request, Response, NextFunction } from 'express';
import { WordpressService } from '../services/wordpress.service';
import { UserService } from '../services/user.service';
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
}
