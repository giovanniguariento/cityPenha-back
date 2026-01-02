import { Request, Response, NextFunction } from 'express';
import { WordpressService } from '../services/wordpress.service'
import { ETypePost, IPost } from '../models/post.interface';
import { isSingleVideoContent } from '../helpers/content.helper';

export class PostController {
  private wordpressService: WordpressService;

  constructor(wordpressService: WordpressService) {
    this.wordpressService = wordpressService;
  }

  public get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      let post: IPost;

      const postSearchResult = await this.wordpressService.getTypePostBySearch(req.params.slug.replaceAll("-", " ").slice(0, 60));
      const postFindResult = postSearchResult.find(post => post._embedded.self[0].slug === req.params.slug);

      if (!postFindResult) {
        res.status(404).json({ success: false, message: 'Post not found' });
        return;
      };

      if (postFindResult?.subtype === ETypePost.POST) {
        post = await this.wordpressService.getPost(postFindResult?.id);
      } else {
        post = await this.wordpressService.getAd(postFindResult?.id);
      }

      if (!post) {
        res.status(404).json({ success: false, message: 'Post not found' });
        return;
      }

      const [categories, tags] = await Promise.all([
        this.wordpressService.getCategoriesById(post.categories),
        this.wordpressService.getTagsById(post.tags),
      ]);

      const tagsName = post.tags.map((tag) => {
        const tagNameItem = tags.find((tagItem) => tagItem.id === tag);
        return tagNameItem?.name
      })

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

      res.status(200).json({
        title: post.title.rendered,
        resume: post.excerpt.rendered,
        readingTime: post.acf.reading_time,
        date: post.date,
        author,
        image: post._embedded && post._embedded['wp:featuredmedia'] ? post._embedded['wp:featuredmedia'][0].source_url : "",
        content: post.content.rendered,
        tags: tagsName,
        categoryName: categories[0].name,
        onlyVideo: isSingleVideoContent(post.content.rendered)
      });
    } catch (error) {
      next(error);
    }
  };
}
