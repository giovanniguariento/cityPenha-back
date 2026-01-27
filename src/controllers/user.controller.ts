import { Request, Response, NextFunction } from 'express';
import { WordpressService } from '../services/wordpress.service'
import { UserService } from '../services/user.service';
import { User } from '../generated/prisma/client';

export class UserController {
  private wordpressService: WordpressService;
  private userService: UserService;

  constructor(wordpressService: WordpressService, userService: UserService) {
    this.wordpressService = wordpressService;
    this.userService = userService;
  }

  public create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, firebaseUid, name, photoUrl } = req.body
      if (!email || !firebaseUid || !name || !photoUrl) return;

      const user = await this.userService.findByFirebaseUid(firebaseUid);
      console.log(user)

      if (user) res.status(200).json(user);

      const userWordpress = await this.wordpressService.createUser(email);
      const userDatabase = await this.userService.create({
        email,
        firebaseUid,
        wordpressId: userWordpress.id,
        name,
        photoUrl,
      } as User)

      res.status(200).json(userDatabase);
    } catch (error) {
      next(error);
    }
  };
}
