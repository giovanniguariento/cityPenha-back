import { Request, Response, NextFunction } from 'express';
import { WordpressService } from '../services/wordpress.service'
import { ETypePost, IPost } from '../models/post.interface';
import { isSingleVideoContent } from '../helpers/content.helper';

export class HomeController {
  private wordpressService: WordpressService;

  constructor(wordpressService: WordpressService) {
    this.wordpressService = wordpressService;
  }

  public getAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [posts, categories, ads] = await Promise.all([
        this.wordpressService.getAllPosts(),
        this.wordpressService.getCategories(),
        this.wordpressService.getAllAds()
      ]);

      let feedFinal: IPost[] = [];
      let adIndex = 0;

      for (const [index, value] of posts.entries()) {
        feedFinal.push(value)

        if ((index + 1) % 4 === 0 && ads[adIndex]) {
          feedFinal.push(ads[adIndex]);
          adIndex = (adIndex + 1) % ads.length; // Rotaciona os ads se acabarem
        }
      }


      // if (feedFinal.length < 5) {
      //   feedFinal.push(ads[0]);
      // }

      const feed = feedFinal.map((post) => {
        let author: { name: string; avatarUrl: string };
        if (post.type === ETypePost.POST) {
          author = {
            name: post.authors[0].display_name,
            avatarUrl: post.authors[0].avatar_url.url
          };
        } else {
          author = {
            name: "Patrocinado",
            avatarUrl: "assets/logo-perfil.svg"
          };
        }

        return {
          slug: post.slug,
          id: post.id,
          title: post.title.rendered,
          type: post.type,
          author,
          tags: post.tags,
          readingTime: post.acf.reading_time,
          image: post._embedded && post._embedded['wp:featuredmedia'] ? post._embedded['wp:featuredmedia'][0].source_url : "",
          categories: post.categories,
          categoryName: '',
          onlyVideo: isSingleVideoContent(post.content.rendered)
        }
      })

      const categoriesWithPosts = categories.map((category) => {
        const relatedPosts = feed.filter((post, index, self) => {
          if (post.type === ETypePost.AD) {
            // console.log(self)
            const repetido = self.find((postNovo) => postNovo.id === post.id);
            // console.log(repetido, post, "ENTROUUUUUUUUUUUU")
            // if (repetido) return false;
          }
          return post.categories.includes(category.id)
        }

        );

        for (const post of relatedPosts) {
          post.categoryName = category.name;
        }

        return {
          id: category.id,
          name: category.name,
          posts: relatedPosts
        };
      })

      if (posts.length === 0 && categories.length === 0) {
        res.status(404).json({ success: false, message: 'Posts not found' });
        return;
      }

      res.status(200).json({
        categories: categoriesWithPosts,
        posts: feed.slice(0, 11)
      });
    } catch (error) {
      next(error);
    }
  };
}
