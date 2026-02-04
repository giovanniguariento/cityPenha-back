import { Request, Response, NextFunction } from 'express';
import { ETypePost, type IPost } from '../models/post.interface';
import { WordpressService } from '../services/wordpress.service';
import { toPostDetail } from '../helpers/post.helper';

export class PostController {
  constructor(private readonly wordpressService: WordpressService) { }

  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const slug = req.params.slug as string;
      const searchQuery = slug.replaceAll('-', ' ').slice(0, 60);
      const searchResults = await this.wordpressService.getTypePostBySearch(searchQuery);
      const found = searchResults.find((p) => p._embedded.self[0].slug === slug);

      if (!found) {
        res.status(404).json({ success: false, message: 'Post not found' });
        return;
      }

      const post: IPost =
        found.subtype === ETypePost.POST
          ? await this.wordpressService.getPost(found.id)
          : await this.wordpressService.getAd(found.id);

      const [categories, tags] = await Promise.all([
        this.wordpressService.getCategoriesById(post.categories),
        this.wordpressService.getTagsById(post.tags),
      ]);

      const payload = toPostDetail(post, categories, tags);

      res.status(200).json(payload);
    } catch (error) {
      next(error);
    }
  };
}
