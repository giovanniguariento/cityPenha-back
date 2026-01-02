export interface IPost {
  id: number;
  date: Date;
  slug: string;
  title: {
    rendered: string
  };
  type: ETypePost;
  subtype: ETypePost;
  authors: {
    display_name: string,
    avatar_url: {
      url: string
    }
  }[];
  tags: number[];
  acf: {
    reading_time: number
  };
  _embedded: {
    'wp:featuredmedia': IFeaturedMedia[],
    author: {
      name: string,
      avatar_urls: {
        "96": string
      }
    }[],
    self: {
      slug: string
    }[]
  };
  categories: number[],
  excerpt: {
    rendered: string
  },
  content: {
    rendered: string
  }
}

export interface IFeaturedMedia {
  source_url: string;
}

export enum ETypePost {
  POST = "post",
  AD = "anuncio"
}
