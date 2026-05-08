import type { MetricDescriptor } from './registry';

export const missionsCompletedMetric: MetricDescriptor = {
  key: 'missions_completed',
  description: 'Quantidade de missões atualmente concluídas (UserMission.completed = true).',
  acceptedParams: [],
  handler: async ({ userId, tx }) => {
    return tx.userMission.count({ where: { userId, completed: true } });
  },
};
