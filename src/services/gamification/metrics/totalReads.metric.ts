import type { MetricDescriptor } from './registry';

export const totalReadsMetric: MetricDescriptor = {
  key: 'total_reads',
  description: 'Quantidade de posts distintos lidos pelo usuário (read_posts).',
  acceptedParams: [],
  handler: async ({ userId, tx }) => {
    return tx.readPost.count({ where: { userId } });
  },
};
