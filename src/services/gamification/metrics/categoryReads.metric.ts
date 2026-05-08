import type { MetricDescriptor } from './registry';

/**
 * Quantidade de posts distintos lidos pelo usuário em uma dada categoria WordPress.
 * Usa raw SQL pois Prisma não tem relação modelada entre `read_posts.wordpressPostId`
 * e as tabelas `wp_term_relationships` / `wp_term_taxonomy` (são bases lógicas distintas).
 *
 * params: { categoryId: number } (term_id da categoria; valor que o WP REST devolve em /categories/:id).
 */
export const categoryReadsMetric: MetricDescriptor = {
  key: 'category_reads',
  description: 'Posts distintos lidos pelo usuário pertencentes à categoria WordPress informada.',
  acceptedParams: ['categoryId'],
  handler: async ({ userId, params, tx }) => {
    const categoryId = params && typeof params.categoryId === 'number' ? params.categoryId : null;
    if (categoryId == null) return 0;

    const rows = await tx.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(DISTINCT rp.wordpressPostId) AS total
      FROM read_posts rp
      JOIN wp_term_relationships tr ON tr.object_id = rp.wordpressPostId
      JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
      WHERE rp.userId = ${userId}
        AND tt.taxonomy = 'category'
        AND tt.term_id = ${categoryId}
    `;
    const total = rows[0]?.total ?? BigInt(0);
    return Number(total);
  },
};
