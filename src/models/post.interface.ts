export interface IPost {
  id: number;
  date: Date;
  slug: string;
  title: {
    rendered: string
  };
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
    'wp:featuredmedia': IFeaturedMedia[]
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