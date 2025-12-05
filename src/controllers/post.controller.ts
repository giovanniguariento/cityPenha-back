import { Request, Response, NextFunction } from 'express';
import { WordpressService } from '../services/wordpress.service'

export class PostController {
  private wordpressService: WordpressService;

  constructor(wordpressService: WordpressService) {
    this.wordpressService = wordpressService;
  }

  public get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [post, tags] = await Promise.all([
        this.wordpressService.getPost(req.params.id),
        this.wordpressService.getTags(),
      ]);

      const categoryName = await this.wordpressService.getCategory(post.categories[0]);

      if (!post) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }

      const tagsName = post.tags.map((tag) => {
        const tagNameItem = tags.find((tagItem) => tagItem.id === tag);
        return tagNameItem?.name
      })

      res.status(200).json({
        title: post.title.rendered,
        resume: post.excerpt.rendered,
        readingTime: post.acf.reading_time,
        date: post.date,
        author: {
          name: post.authors[0].display_name,
          avatarUrl: post.authors[0].avatar_url.url
        },
        image: post._embedded['wp:featuredmedia'][0].source_url,
        content: post.content.rendered,
        tags: tagsName,
        categoryName: categoryName.name
      });
    } catch (error) {
      next(error);
    }
  };
}
