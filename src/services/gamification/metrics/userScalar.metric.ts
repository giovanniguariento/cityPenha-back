import type { MetricDescriptor } from './registry';

export const xpMetric: MetricDescriptor = {
  key: 'xp',
  description: 'XP atual do usuário.',
  acceptedParams: [],
  handler: async ({ userId, tx }) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { xp: true } });
    return user?.xp ?? 0;
  },
};

export const coinsMetric: MetricDescriptor = {
  key: 'coins',
  description: 'Saldo atual de moedas do usuário.',
  acceptedParams: [],
  handler: async ({ userId, tx }) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { coins: true } });
    return user?.coins ?? 0;
  },
};

/**
 * Nível atual do usuário (maior `levelNumber` cujos minXp e minCompletedMissions são satisfeitos).
 * Implementação leve para uso em criteria — o LevelEngine carrega levels separadamente para a resposta.
 */
export const currentLevelMetric: MetricDescriptor = {
  key: 'current_level',
  description: 'Nível atual do usuário (maior level cujos requisitos mínimos de XP e missões foram atingidos).',
  acceptedParams: [],
  handler: async ({ userId, tx }) => {
    const [user, completedCount, levels] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { xp: true } }),
      tx.userMission.count({ where: { userId, completed: true } }),
      tx.level.findMany({ orderBy: { levelNumber: 'asc' } }),
    ]);
    if (!user || levels.length === 0) return 0;

    let current = 0;
    for (const level of levels) {
      if (user.xp >= level.minXp && completedCount >= level.minCompletedMissions) {
        current = level.levelNumber;
      } else {
        break;
      }
    }
    return current;
  },
};
