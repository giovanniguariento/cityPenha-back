import type { MetricDescriptor } from './registry';

export const totalExperienceLikesMetric: MetricDescriptor = {
  key: 'total_experience_likes',
  description: 'Quantidade de experiências (Agenda) que o usuário curtiu ativamente.',
  acceptedParams: [],
  handler: async ({ userId, tx }) => {
    return tx.experienceLike.count({ where: { userId } });
  },
};
