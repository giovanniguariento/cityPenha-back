import type { MetricDescriptor } from './registry';

export const totalCommentsMetric: MetricDescriptor = {
  key: 'total_comments',
  description: 'Quantidade total de comentários publicados pelo usuário (top-level e respostas).',
  acceptedParams: [],
  handler: async ({ userId, tx }) => {
    return tx.comment.count({ where: { userId } });
  },
};
