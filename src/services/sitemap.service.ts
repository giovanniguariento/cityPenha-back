import * as cheerio from 'cheerio';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { extractPostVideo, isSingleVideoContent } from '../helpers/content.helper';

/** Video extension of a sitemap entry — every field is required by Google. */
export interface SitemapVideoEntry {
  title: string;
  description: string;
  thumbnailUrl: string;
  /** Direct media file URL, for self-hosted videos. */
  contentUrl?: string;
  /** Player URL, for iframe embeds. */
  embedUrl?: string;
}

export interface SitemapPostEntry {
  slug: string;
  categorySlug: string;
  lastmod: string;
  /** Present only for watch pages whose player and thumbnail could be resolved. */
  video?: SitemapVideoEntry;
}

/**
 * Lists published posts for sitemap.xml with primary category slug and lastmod.
 * Uses Prisma against wp_* tables (avoids WP REST pagination limits).
 */
export async function listSitemapPosts(limit = 5000): Promise<SitemapPostEntry[]> {
  try {
    const posts = await prisma.wp_posts.findMany({
      where: {
        post_status: 'publish',
        post_type: 'post',
        post_name: { not: '' },
      },
      select: {
        ID: true,
        post_name: true,
        post_title: true,
        post_excerpt: true,
        post_content: true,
        post_modified_gmt: true,
        post_date_gmt: true,
      },
      orderBy: { post_modified_gmt: 'desc' },
      take: limit,
    });

    if (posts.length === 0) return [];

    const postIds = posts.map((p) => p.ID);

    // Primary category per post: first category term by term_order / term_taxonomy_id
    const relationships = await prisma.wp_term_relationships.findMany({
      where: { object_id: { in: postIds } },
      select: {
        object_id: true,
        term_taxonomy_id: true,
        term_order: true,
      },
      orderBy: { term_order: 'asc' },
    });

    const taxonomyIds = [...new Set(relationships.map((r) => r.term_taxonomy_id))];
    const taxonomies =
      taxonomyIds.length === 0
        ? []
        : await prisma.wp_term_taxonomy.findMany({
            where: {
              term_taxonomy_id: { in: taxonomyIds },
              taxonomy: 'category',
            },
            select: { term_taxonomy_id: true, term_id: true },
          });

    const categoryTaxonomyIds = new Set(taxonomies.map((t) => t.term_taxonomy_id));
    const termIds = taxonomies.map((t) => t.term_id);
    const terms =
      termIds.length === 0
        ? []
        : await prisma.wp_terms.findMany({
            where: { term_id: { in: termIds } },
            select: { term_id: true, slug: true },
          });

    const termIdToSlug = new Map(terms.map((t) => [t.term_id.toString(), t.slug]));
    const taxonomyIdToTermId = new Map(
      taxonomies.map((t) => [t.term_taxonomy_id.toString(), t.term_id.toString()])
    );

    const postIdToCategorySlug = new Map<string, string>();
    for (const rel of relationships) {
      const objectKey = rel.object_id.toString();
      if (postIdToCategorySlug.has(objectKey)) continue;
      if (!categoryTaxonomyIds.has(rel.term_taxonomy_id)) continue;
      const termId = taxonomyIdToTermId.get(rel.term_taxonomy_id.toString());
      if (!termId) continue;
      const slug = termIdToSlug.get(termId);
      if (slug) postIdToCategorySlug.set(objectKey, slug);
    }

    // Parsing every post with cheerio would dominate this request, so only posts
    // whose markup actually mentions a player are inspected.
    const watchPages = posts.filter(
      (p) =>
        (p.post_content.includes('<video') || p.post_content.includes('<iframe')) &&
        isSingleVideoContent(p.post_content)
    );
    const featuredImageByPostId = await resolveFeaturedImageUrls(
      watchPages.map((p) => p.ID),
      resolveUploadsBaseUrl(posts.map((p) => p.post_content))
    );
    const videoByPostId = new Map<string, SitemapVideoEntry>();
    for (const page of watchPages) {
      const key = page.ID.toString();
      const video = toSitemapVideo(page, featuredImageByPostId.get(key));
      if (video) videoByPostId.set(key, video);
    }

    return posts
      .filter((p) => !!p.post_name)
      .map((p) => {
        const modified = p.post_modified_gmt ?? p.post_date_gmt;
        const lastmod =
          modified instanceof Date
            ? modified.toISOString().slice(0, 10)
            : String(modified ?? '').slice(0, 10);
        const video = videoByPostId.get(p.ID.toString());
        return {
          slug: p.post_name!,
          categorySlug: postIdToCategorySlug.get(p.ID.toString()) ?? 'geral',
          lastmod: lastmod || new Date().toISOString().slice(0, 10),
          ...(video ? { video } : {}),
        };
      });
  } catch (err) {
    logger.error({ err }, 'Failed to list sitemap posts');
    return [];
  }
}

interface SitemapPostRow {
  post_title: string;
  post_excerpt: string;
  post_content: string;
}

function toSitemapVideo(
  post: SitemapPostRow,
  featuredImageUrl: string | undefined
): SitemapVideoEntry | null {
  const video = extractPostVideo(post.post_content, featuredImageUrl);
  if (!video?.thumbnailUrl) return null;
  if (!video.contentUrl && !video.embedUrl) return null;

  const title = plainText(post.post_title);
  if (!title) return null;

  return {
    title,
    description: plainText(post.post_excerpt) || title,
    thumbnailUrl: video.thumbnailUrl,
    ...(video.contentUrl ? { contentUrl: video.contentUrl } : {}),
    ...(video.embedUrl ? { embedUrl: video.embedUrl } : {}),
  };
}

/**
 * Maps post ID to its featured image URL, built from `_wp_attached_file` so the
 * result follows the live uploads host instead of the possibly stale attachment
 * `guid` left behind by past migrations.
 */
async function resolveFeaturedImageUrls(
  postIds: bigint[],
  uploadsBaseUrl: string | undefined
): Promise<Map<string, string>> {
  if (postIds.length === 0 || !uploadsBaseUrl) return new Map();

  const thumbnailMeta = await prisma.wp_postmeta.findMany({
    where: { post_id: { in: postIds }, meta_key: '_thumbnail_id' },
    select: { post_id: true, meta_value: true },
  });

  const attachmentIds = thumbnailMeta
    .map((m) => Number(m.meta_value))
    .filter((id) => Number.isFinite(id) && id > 0)
    .map((id) => BigInt(id));
  if (attachmentIds.length === 0) return new Map();

  const fileMeta = await prisma.wp_postmeta.findMany({
    where: { post_id: { in: attachmentIds }, meta_key: '_wp_attached_file' },
    select: { post_id: true, meta_value: true },
  });

  const fileByAttachmentId = new Map(
    fileMeta
      .filter((m) => !!m.meta_value)
      .map((m) => [m.post_id.toString(), m.meta_value!.replace(/^\/+/, '')])
  );

  const urlByPostId = new Map<string, string>();
  for (const meta of thumbnailMeta) {
    const file = fileByAttachmentId.get(String(Number(meta.meta_value)));
    if (file) urlByPostId.set(meta.post_id.toString(), `${uploadsBaseUrl}${file}`);
  }
  return urlByPostId;
}

/** Infers `https://host/.../wp-content/uploads/` from any media URL in the corpus. */
function resolveUploadsBaseUrl(contents: string[]): string | undefined {
  for (const content of contents) {
    const match = content.match(/https?:\/\/[^"'\s]*?\/wp-content\/uploads\//);
    if (match) return match[0];
  }
  return undefined;
}

function plainText(html: string): string {
  if (!html) return '';
  return cheerio.load(html)('body').text().replace(/\s+/g, ' ').trim();
}
