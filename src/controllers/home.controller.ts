import { Request, Response, NextFunction } from 'express';
import { WordpressService } from '../services/wordpress.service'

export class HomeController {
  private wordpressService: WordpressService;

  constructor(wordpressService: WordpressService) {
    this.wordpressService = wordpressService;
  }

  public getAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [posts, categories] = await Promise.all([
        this.wordpressService.getAllPosts(),
        this.wordpressService.getCategories()
      ]);

      const filtedPosts = posts.map((post) => {
        return {
          slug: post.slug,
          id: post.id,
          title: post.title.rendered,
          author: {
            name: post.authors[0].display_name,
            avatarUrl: post.authors[0].avatar_url.url
          },
          tags: post.tags,
          readingTime: post.acf.reading_time,
          image: post._embedded ? post._embedded['wp:featuredmedia'][0].source_url : "",
          categories: post.categories,
          categoryName: ''
        }
      })

      let result = categories.map((category) => {
        const relatedPosts = filtedPosts.filter((post) =>
          post.categories.includes(category.id)
        );

        for (const post of relatedPosts) {
          post.categoryName = category.name;
        }

        return {
          id: category.id,
          name: category.name, // Mantém as props da categoria (id, name, slug)
          posts: relatedPosts // Adiciona o array de posts filtrados
        };
      })

      if (posts.length === 0 && categories.length === 0) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }

      res.status(200).json({
        categories: result,
        posts: filtedPosts
      });
    } catch (error) {
      next(error);
    }
  };
}
