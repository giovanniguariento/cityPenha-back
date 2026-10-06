export interface IPost {
  id: number;
  date: Date | string;
  slug: string;
  title: { rendered: string };
  type: ETypePost;
  subtype: ETypePost;
  /** WordPress core post author user id (present on REST post objects). */
  author?: number;
  authors?: {
    display_name?: string;
    user_id?: number;
    term_id?: number;
    avatar_url?: string | { url?: string };
  }[];
  tags: number[];
  acf: { reading_time: number };
  _embedded: {
    'wp:featuredmedia'?: IFeaturedMedia[];
    author?: { id?: number; name: string; avatar_urls: { '96': string } }[];
    self: { slug: string }[];
  };
  categories: number[];
  excerpt: { rendered: string };
  content: { rendered: string };
}

export interface IFeaturedMedia {
  source_url: string;
  media_details?: {
    sizes?: {
      large?: { source_url: string; width: number; height: number };
      full?: { source_url: string };
    };
  };
}

export enum ETypePost {
  POST = "post",
  AD = "anuncio"
}
