/**
 * Avalia missões ativas para um usuário, atualiza progresso e completa/revoga.
 *
 * Para cada missão ativa:
 *  1) Computa progresso primário = MetricCache.get(metricKey, metricParams), capado em `target`.
 *  2) Avalia critério (árvore custom OR fallback `metricKey >= target`).
 *  3) Compara estado anterior `userMission.completed` com `shouldBeCompleted`:
 *     - false → true: cria/atualiza UserMission, concede recompensa via ledger.
 *     - true → false (apenas se `isReversible`): atualiza UserMission, estorna recompensa.
 *     - sem mudança: só atualiza progresso.
 */
import type { Mission, UserMission } from '../../../generated/prisma/client';
import type { MetricCache } from '../metrics/registry';
import type { Tx, MissionWithProgressView, RewardView } from '../types';
import { parseCriteria } from '../criteria/schema';
import { defaultCriteriaFor, evaluateCriteria } from '../criteria/evaluator';
import { applyReward } from './rewardLedger';

export interface MissionEvaluationResult {
  views: MissionWithProgressView[];
  rewards: RewardView[];
}

function nowIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * Aceita Mission cuja `metricKey` está registrada (resto é silenciosamente ignorado para evitar
 * 500 em produção quando uma missão refere-se a métrica removida).
 */
export async function evaluateMissions(args: {
  tx: Tx;
  userId: string;
  missions: Mission[];
  cache: MetricCache;
  knownMetricKeys: Set<string>;
}): Promise<MissionEvaluationResult> {
  const { tx, userId, missions, cache, knownMetricKeys } = args;

  const userMissions = await tx.userMission.findMany({ where: { userId } });
  const userMissionByMissionId = new Map<string, UserMission>(
    userMissions.map((um) => [um.missionId, um])
  );

  const views: MissionWithProgressView[] = [];
  const rewards: RewardView[] = [];

  for (const mission of missions) {
    if (!knownMetricKeys.has(mission.metricKey)) {
      // métrica inexistente — devolve view inerte para não esconder a missão da UI
      const um = userMissionByMissionId.get(mission.id);
      views.push(toView(mission, um, 0));
      continue;
    }

    const metricParams = (mission.metricParams ?? null) as Record<string, unknown> | null;
    const rawValue = await cache.get(mission.metricKey, metricParams);
    const progress = Math.max(0, Math.min(rawValue, mission.target));

    const criteria =
      parseCriteria(mission.criteria) ?? defaultCriteriaFor(mission.metricKey, mission.target, metricParams);
    const { ok: shouldBeCompleted } = await evaluateCriteria(criteria, cache);

    const previous = userMissionByMissionId.get(mission.id);
    const wasCompleted = previous?.completed ?? false;

    let nextCompletedAt: Date | null = previous?.completedAt ?? null;
    if (shouldBeCompleted && !wasCompleted) {
      nextCompletedAt = new Date();
    } else if (!shouldBeCompleted && wasCompleted && mission.isReversible) {
      nextCompletedAt = null;
    } else if (!shouldBeCompleted && wasCompleted && !mission.isReversible) {
      // Missão não reversível e estava completa — mantém status como concluída.
      const um = await tx.userMission.upsert({
        where: { userId_missionId: { userId, missionId: mission.id } },
        create: {
          userId,
          missionId: mission.id,
          progress,
          completed: true,
          completedAt: previous?.completedAt ?? new Date(),
        },
        update: { progress },
      });
      views.push(toView(mission, um, progress));
      continue;
    }

    const finalCompleted =
      shouldBeCompleted || (wasCompleted && !mission.isReversible);

    const upserted = await tx.userMission.upsert({
      where: { userId_missionId: { userId, missionId: mission.id } },
      create: {
        userId,
        missionId: mission.id,
        progress,
        completed: finalCompleted,
        completedAt: nextCompletedAt,
      },
      update: {
        progress,
        completed: finalCompleted,
        completedAt: nextCompletedAt,
      },
    });

    if (shouldBeCompleted && !wasCompleted) {
      const reward = await applyReward({
        tx,
        userId,
        source: `MISSION:${mission.id}`,
        reason: 'granted',
        coinsDelta: mission.coinReward,
        xpDelta: mission.xpReward,
        meta: { missionKey: mission.key },
      });
      if (reward) rewards.push(reward);
    } else if (!shouldBeCompleted && wasCompleted && mission.isReversible) {
      const reward = await applyReward({
        tx,
        userId,
        source: `MISSION:${mission.id}`,
        reason: 'revoked',
        coinsDelta: -mission.coinReward,
        xpDelta: -mission.xpReward,
        meta: { missionKey: mission.key },
      });
      if (reward) rewards.push(reward);
    }

    views.push(toView(mission, upserted, progress));
  }

  return { views, rewards };
}

function toView(mission: Mission, um: UserMission | undefined, progress: number): MissionWithProgressView {
  return {
    id: mission.id,
    key: mission.key,
    title: mission.title,
    description: mission.description ?? null,
    iconUrl: mission.iconUrl ?? null,
    category: mission.category ?? null,
    metricKey: mission.metricKey,
    target: mission.target,
    coinReward: mission.coinReward,
    xpReward: mission.xpReward,
    progress: um?.progress ?? progress,
    completed: um?.completed ?? false,
    completedAt: nowIso(um?.completedAt ?? null),
    isReversible: mission.isReversible,
  };
}

/**
 * View read-only (sem efeito colateral, sem upsert) — usada em GET /mission para usuários
 * autenticados. Para anônimos use `viewMissionsForAnonymous` no service principal.
 */
export async function viewMissionsForUser(args: {
  tx: Tx;
  userId: string;
  missions: Mission[];
  cache: MetricCache;
  knownMetricKeys: Set<string>;
}): Promise<MissionWithProgressView[]> {
  const { tx, userId, missions, cache, knownMetricKeys } = args;
  const userMissions = await tx.userMission.findMany({ where: { userId } });
  const map = new Map(userMissions.map((um) => [um.missionId, um]));

  const views: MissionWithProgressView[] = [];
  for (const mission of missions) {
    let progress = 0;
    if (knownMetricKeys.has(mission.metricKey)) {
      const metricParams = (mission.metricParams ?? null) as Record<string, unknown> | null;
      const raw = await cache.get(mission.metricKey, metricParams);
      progress = Math.max(0, Math.min(raw, mission.target));
    }
    const um = map.get(mission.id);
    views.push(toView(mission, um, progress));
  }
  return views;
}
