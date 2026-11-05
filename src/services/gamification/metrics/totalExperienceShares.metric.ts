import type { MetricDescriptor } from './registry';

export const totalExperienceSharesMetric: MetricDescriptor = {
  key: 'total_experience_shares',
  description: 'Quantidade de experiências (Agenda) que o usuário compartilhou.',
  acceptedParams: [],
  handler: async ({ userId, tx }) => {
    return tx.experienceShare.count({ where: { userId } });
  },
};
