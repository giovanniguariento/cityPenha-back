import { ICategory } from "../models/category.interface";
import { IPost } from "../models/post.interface";
import { ITag } from "../models/tag.interface";

const credentials = Buffer.from(`${process.env.ENV_API_WORDPRESS_ADMIN_USER}:${process.env.ENV_API_WORDPRESS_ADMIN_PASSWORD}`).toString('base64');

export class WordpressService {
  public async getAllPosts(): Promise<IPost[]> {
    const response = await fetch(`${process.env.ENV_API_WORDPRESS}/posts?_embed=wp:featuredmedia&per_page=100`);

    if (!response.ok) {
      throw new Error(`Erro ao buscar posts: ${response.statusText}`);
    }

    return response.json();
  }

  public async getPost(id: number): Promise<IPost> {
    const response = await fetch(`${process.env.ENV_API_WORDPRESS}/posts/${id}?_embed=wp:featuredmedia`);

    if (!response.ok) {
      throw new Error(`Erro ao buscar post: ${response.statusText}`);
    }

    return response.json();
  }

  public async getTypePostBySearch(slug: string): Promise<IPost[]> {
    const response = await fetch(`${process.env.ENV_API_WORDPRESS}/search?search=${slug}&_embed`);

    if (!response.ok) {
      throw new Error(`Erro ao pesquisar post: ${response.statusText}`);
    }

    return response.json();
  }


  public async getCategories(): Promise<ICategory[]> {
    const response = await fetch(`${process.env.ENV_API_WORDPRESS}/categories`);

    if (!response.ok) {
      throw new Error(`Erro ao buscar categorias: ${response.statusText}`);
    }

    return response.json();
  }

  public async getCategoriesById(ids: number[]): Promise<ICategory[]> {
    const response = await fetch(`${process.env.ENV_API_WORDPRESS}/categories?include=${ids.toString()}`);

    if (!response.ok) {
      throw new Error(`Erro ao buscar categoria: ${response.statusText}`);
    }

    return response.json();
  }

  public async getTagsById(ids: number[]): Promise<ITag[]> {
    const response = await fetch(`${process.env.ENV_API_WORDPRESS}/tags?include=${ids.toString()}`);

    if (!response.ok) {
      throw new Error(`Erro ao buscar tags: ${response.statusText}`);
    }

    return response.json();
  }

  public async getAllAds(): Promise<IPost[]> {
    const response = await fetch(`${process.env.ENV_API_WORDPRESS}/ads?_embed`);

    if (!response.ok) {
      throw new Error(`Erro ao buscar anuncios: ${response.statusText}`);
    }

    return response.json();
  }

  public async getAd(id: number): Promise<IPost> {
    const response = await fetch(`${process.env.ENV_API_WORDPRESS}/ads/${id}?_embed&?per_page=100`);

    if (!response.ok) {
      throw new Error(`Erro ao buscar anuncio: ${response.statusText}`);
    }

    return response.json();
  }

  public async createUser(email: string): Promise<any> {
    const newUser = {
      username: email.split('@')[0] + '_' + Math.floor(Math.random() * 1000),
      email,
      password: Math.random().toString(36),
      roles: ['author']
    };

    const response = await fetch(`${process.env.ENV_API_WORDPRESS}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${credentials}`
      },
      body: JSON.stringify(newUser)
    });

    if (!response.ok) {
      throw new Error(`Erro ao criar user: ${response.statusText}`);
    }

    return response.json();
  }
}
