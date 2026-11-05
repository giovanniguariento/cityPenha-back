import type { MetricDescriptor } from './registry';

export const totalExperienceCommentsMetric: MetricDescriptor = {
  key: 'total_experience_comments',
  description:
    'Quantidade total de comentários do usuário em experiências da Agenda (top-level e respostas).',
  acceptedParams: [],
  handler: async ({ userId, tx }) => {
    return tx.experienceComment.count({ where: { userId } });
  },
};
