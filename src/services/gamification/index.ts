/**
 * Facade pública da engine de gamificação dinâmica.
 *
 * Controllers chamam apenas `notify(eventType, payload)` quando algo acontece.
 * Internamente roda em uma transação:
 *   1) Side effect específico do evento (ex.: insert read_post + XP).
 *   2) Avalia missões ativas → grant/revoke via ledger.
 *   3) Avalia insígnias ativas → concede e loga.
 *   4) Avalia level → grant level-up reward (idempotente).
 *   5) Devolve snapshot completo p/ a resposta HTTP.
 *
 * Listeners adicionais (analytics, push) podem se inscrever via `onDomainEvent`
 * sem acoplar ao engine principal.
 */
import { prisma } from '../../lib/prisma';
import { toBrazilYyyyMmDd } from '../../lib/brTime';
import { listMetricKeys, registerBuiltInMetrics } from './metrics/index';
import { MetricCache } from './metrics/registry';
import { evaluateMissions, viewMissionsForUser } from './engine/missionEngine';
import { evaluateBadges } from './engine/badgeEngine';
import { evaluateLevel } from './engine/levelEngine';
import { applyReward } from './engine/rewardLedger';
import { emitDomainEvent } from './events/bus';
import type {
  BadgeView,
  DomainEventPayload,
  DomainEventType,
  GamificationUser,
  LevelProgressView,
  LevelView,
  MissionWithProgressView,
  NotifyResult,
  RewardView,
  Tx,
} from './types';

const XP_PER_READ = 10;

registerBuiltInMetrics();

/**
 * Carrega missões ativas com filtro opcional de janela temporal (`startsAt`/`endsAt`).
 */
async function loadActiveMissions(tx: Tx) {
  const now = new Date();
  return tx.mission.findMany({
    where: {
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    orderBy: { key: 'asc' },
  });
}

async function loadActiveBadges(tx: Tx) {
  return tx.badge.findMany({ where: { isActive: true }, orderBy: { key: 'asc' } });
}

async function loadLevels(tx: Tx) {
  return tx.level.findMany({ orderBy: { levelNumber: 'asc' } });
}

async function loadDaysWithReads(tx: Tx, userId: string): Promise<string[]> {
  const reads = await tx.readPost.findMany({ where: { userId }, select: { createdAt: true } });
  return [...new Set(reads.map((r) => toBrazilYyyyMmDd(r.createdAt)))].sort();
}

/**
 * Side-effect do evento `read`: garante registro idempotente em `read_posts` e concede
 * `XP_PER_READ` pela primeira vez. Idempotente — chamado de dentro de `notify`.
 */
async function applyReadSideEffect(tx: Tx, userId: string, wordpressPostId: number): Promise<RewardView[]> {
  const existing = await tx.readPost.findUnique({
    where: { userId_wordpressPostId: { userId, wordpressPostId } },
  });
  if (existing) return [];

  await tx.readPost.create({ data: { userId, wordpressPostId } });
  const reward = await applyReward({
    tx,
    userId,
    source: `READ_XP:${wordpressPostId}`,
    reason: 'granted',
    coinsDelta: 0,
    xpDelta: XP_PER_READ,
    meta: { wordpressPostId },
  });
  return reward ? [reward] : [];
}

export class GamificationFacade {
  /**
   * Publica um evento de domínio e devolve o snapshot atualizado.
   * Chamado pelos controllers após cada ação relevante.
   */
  async notify(eventType: DomainEventType, payload: DomainEventPayload): Promise<NotifyResult> {
    const { userId } = payload;
    if (!userId) throw new Error('notify: userId is required');

    const result = await prisma.$transaction(
      async (tx) => {
        const rewards: RewardView[] = [];

        if (eventType === 'read' && payload.wordpressPostId) {
          rewards.push(...(await applyReadSideEffect(tx, userId, payload.wordpressPostId)));
        }

        const [missions, badges, levels] = await Promise.all([
          loadActiveMissions(tx),
          loadActiveBadges(tx),
          loadLevels(tx),
        ]);
        const knownMetricKeys = new Set(listMetricKeys());
        const cache = new MetricCache(userId, tx);

        const missionResult = await evaluateMissions({
          tx,
          userId,
          missions,
          cache,
          knownMetricKeys,
        });
        rewards.push(...missionResult.rewards);

        // Mission completion changes `missions_completed` → invalida cache antes de badges/level.
        cache.invalidate('missions_completed');

        const badgeResult = await evaluateBadges({
          tx,
          userId,
          badges,
          cache,
          knownMetricKeys,
        });
        rewards.push(...badgeResult.rewards);

        const levelResult = await evaluateLevel({ tx, userId, levels });
        rewards.push(...levelResult.rewards);

        const [user, completedMissionsCount, daysWithReads] = await Promise.all([
          tx.user.findUniqueOrThrow({
            where: { id: userId },
            select: { id: true, xp: true, coins: true },
          }),
          tx.userMission.count({ where: { userId, completed: true } }),
          loadDaysWithReads(tx, userId),
        ]);

        return {
          user: user as GamificationUser,
          completedMissionsCount,
          daysWithReads,
          missions: missionResult.views,
          badges: badgeResult.views,
          level: levelResult.level,
          levelProgress: levelResult.progress,
          rewards,
        };
      },
      { timeout: 15_000 }
    );

    // Emite evento "fora" da transação para não atrapalhar o ROLLBACK em listeners pesados.
    void emitDomainEvent(eventType, payload);

    return result;
  }

  /**
   * Snapshot completo do usuário (sem disparar eventos). Usado em `GET /user/me`.
   */
  async getUserSummary(userId: string): Promise<NotifyResult> {
    return this.notify('manual_recompute', { userId });
  }

  /** Lista de dias (YYYY-MM-DD, fuso BR) em que o usuário leu pelo menos um post. */
  async getDaysWithReads(userId: string): Promise<string[]> {
    return loadDaysWithReads(prisma, userId);
  }

  /** Quantidade de missões concluídas atualmente (UserMission.completed=true). */
  async getCompletedMissionsCount(userId: string): Promise<number> {
    return prisma.userMission.count({ where: { userId, completed: true } });
  }

  /** Catálogo (sem progresso) — usado em GET /mission anônimo. */
  async getAllMissions(): Promise<MissionWithProgressView[]> {
    const missions = await loadActiveMissions(prisma);
    return missions.map((m) => ({
      id: m.id,
      key: m.key,
      title: m.title,
      description: m.description ?? null,
      iconUrl: m.iconUrl ?? null,
      category: m.category ?? null,
      metricKey: m.metricKey,
      target: m.target,
      coinReward: m.coinReward,
      xpReward: m.xpReward,
      progress: 0,
      completed: false,
      completedAt: null,
      isReversible: m.isReversible,
    }));
  }

  /** Lista missões com progresso para usuário registrado, sem efeitos colaterais. */
  async getMissionsWithUserProgress(userId: string): Promise<MissionWithProgressView[]> {
    const missions = await loadActiveMissions(prisma);
    const knownMetricKeys = new Set(listMetricKeys());
    const cache = new MetricCache(userId, prisma);
    return viewMissionsForUser({
      tx: prisma,
      userId,
      missions,
      cache,
      knownMetricKeys,
    });
  }

  /** Insígnias do usuário (todas as ativas com flag `earned` + progresso). */
  async getUserBadges(userId: string): Promise<BadgeView[]> {
    const badges = await loadActiveBadges(prisma);
    const knownMetricKeys = new Set(listMetricKeys());
    const cache = new MetricCache(userId, prisma);
    const userBadges = await prisma.userBadge.findMany({ where: { userId } });
    const map = new Map(userBadges.map((ub) => [ub.badgeId, ub]));

    const views: BadgeView[] = [];
    for (const badge of badges) {
      let progress: number | null = null;
      const metricParams = (badge.metricParams ?? null) as Record<string, unknown> | null;
      if (badge.metricKey && knownMetricKeys.has(badge.metricKey)) {
        progress = await cache.get(badge.metricKey, metricParams);
      }
      const ub = map.get(badge.id);
      views.push({
        id: badge.id,
        key: badge.key,
        title: badge.title,
        description: badge.description ?? null,
        iconUrl: badge.iconUrl ?? null,
        metricKey: badge.metricKey ?? null,
        threshold: badge.threshold ?? null,
        earned: !!ub,
        earnedAt: ub ? ub.earnedAt.toISOString() : null,
        progress,
      });
    }
    return views;
  }

  /** Nível atual (sem efeitos colaterais). Compat com chamadas legadas. */
  async getUserLevel(userId: string): Promise<LevelView | null> {
    const levels = await loadLevels(prisma);
    if (levels.length === 0) return null;
    const [user, completedMissionsCount] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      this.getCompletedMissionsCount(userId),
    ]);
    if (!user) return null;
    let current = levels[0];
    for (const level of levels) {
      if (user.xp >= level.minXp && completedMissionsCount >= level.minCompletedMissions) {
        current = level;
      } else {
        break;
      }
    }
    return {
      levelNumber: current.levelNumber,
      minXp: current.minXp,
      minCompletedMissions: current.minCompletedMissions,
      title: current.title ?? null,
      iconUrl: current.iconUrl ?? null,
    };
  }

  /** Snapshot de progresso para a barra de UI; null se não houver levels. */
  async getUserLevelProgress(userId: string): Promise<LevelProgressView | null> {
    const levels = await loadLevels(prisma);
    if (levels.length === 0) return null;
    return prisma
      .$transaction(async (tx) => evaluateLevel({ tx, userId, levels }))
      .then((r) => r.progress);
  }

  /**
   * Recomputa do zero todas as missões/insígnias/level para um usuário.
   * Útil em endpoint admin após mudar regras (`POST /admin/recompute/:userId`).
   */
  async recompute(userId: string): Promise<NotifyResult> {
    return this.notify('manual_recompute', { userId });
  }
}

export const gamificationFacade = new GamificationFacade();
