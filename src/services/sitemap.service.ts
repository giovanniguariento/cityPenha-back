import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export interface SitemapPostEntry {
  slug: string;
  categorySlug: string;
  lastmod: string;
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

    return posts
      .filter((p) => !!p.post_name)
      .map((p) => {
        const modified = p.post_modified_gmt ?? p.post_date_gmt;
        const lastmod =
          modified instanceof Date
            ? modified.toISOString().slice(0, 10)
            : String(modified ?? '').slice(0, 10);
        return {
          slug: p.post_name!,
          categorySlug: postIdToCategorySlug.get(p.ID.toString()) ?? 'geral',
          lastmod: lastmod || new Date().toISOString().slice(0, 10),
        };
      });
  } catch (err) {
    logger.error({ err }, 'Failed to list sitemap posts');
    return [];
  }
}
