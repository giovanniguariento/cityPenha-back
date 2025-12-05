import { ICategory } from "../models/category.interface";
import { IPost } from "../models/post.interface";
import { ITag } from "../models/tag.interface";

export class WordpressService {
  public async getAllPosts(): Promise<IPost[]> {
    const response = await fetch(`${process.env.ENV_API_WORDPRESS}/posts?_embed=wp:featuredmedia`);

    if (!response.ok) {
      throw new Error(`Erro ao buscar posts: ${response.statusText}`);
    }

    return response.json();
  }

  public async getPost(id: string): Promise<IPost> {
    const response = await fetch(`${process.env.ENV_API_WORDPRESS}/posts/${id}?_embed=wp:featuredmedia`);

    if (!response.ok) {
      throw new Error(`Erro ao buscar post: ${response.statusText}`);
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

  public async getCategory(id: number): Promise<ICategory> {
    const response = await fetch(`${process.env.ENV_API_WORDPRESS}/categories/${id}`);

    if (!response.ok) {
      throw new Error(`Erro ao buscar categoria: ${response.statusText}`);
    }

    return response.json();
  }

  public async getTags(): Promise<ITag[]> {
    const response = await fetch(`${process.env.ENV_API_WORDPRESS}/tags?per_page=100`);

    if (!response.ok) {
      throw new Error(`Erro ao buscar categorias: ${response.statusText}`);
    }

    return response.json();
  }
}
