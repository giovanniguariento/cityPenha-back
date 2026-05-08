/**
 * Calcula o nível atual e o progresso para o próximo, e — se houver subida líquida —
 * concede `rewardCoins`/`rewardXp` por level cruzado, registrando no ledger
 * (idempotente: uma source `LEVEL_UP:N` só pode existir uma vez por usuário/level).
 */
import type { Level } from '../../../generated/prisma/client';
import type { Tx, LevelView, LevelProgressView, RewardView } from '../types';
import { applyReward } from './rewardLedger';

export interface LevelEvaluationResult {
  level: LevelView | null;
  progress: LevelProgressView | null;
  rewards: RewardView[];
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function progressToTarget(current: number, target: number): number {
  if (target <= 0) return 100;
  return clampPercent((current / target) * 100);
}

function pickCurrentLevel(
  levels: Level[],
  xp: number,
  completedMissionsCount: number
): Level | null {
  if (levels.length === 0) return null;
  let current = levels[0];
  for (const level of levels) {
    if (xp >= level.minXp && completedMissionsCount >= level.minCompletedMissions) {
      current = level;
    } else {
      break;
    }
  }
  return current;
}

export async function evaluateLevel(args: {
  tx: Tx;
  userId: string;
  levels: Level[];
}): Promise<LevelEvaluationResult> {
  const { tx, userId, levels } = args;

  if (levels.length === 0) {
    return { level: null, progress: null, rewards: [] };
  }

  const [user, completedMissionsCount] = await Promise.all([
    tx.user.findUnique({ where: { id: userId } }),
    tx.userMission.count({ where: { userId, completed: true } }),
  ]);
  if (!user) {
    return { level: null, progress: null, rewards: [] };
  }

  const current = pickCurrentLevel(levels, user.xp, completedMissionsCount);
  if (!current) {
    return { level: null, progress: null, rewards: [] };
  }

  // Concede recompensa para cada level cruzado (idempotente via ledger).
  const rewards: RewardView[] = [];
  const candidates = levels.filter(
    (l) => l.levelNumber <= current.levelNumber && (l.rewardCoins > 0 || l.rewardXp > 0)
  );
  if (candidates.length > 0) {
    const sources = candidates.map((l) => `LEVEL_UP:${l.levelNumber}`);
    const alreadyPaid = await tx.rewardLedger.findMany({
      where: { userId, source: { in: sources } },
      select: { source: true },
    });
    const paidSet = new Set(alreadyPaid.map((r) => r.source));
    for (const level of candidates) {
      const src = `LEVEL_UP:${level.levelNumber}`;
      if (paidSet.has(src)) continue;
      const reward = await applyReward({
        tx,
        userId,
        source: src,
        reason: 'granted',
        coinsDelta: level.rewardCoins,
        xpDelta: level.rewardXp,
        meta: { levelTitle: level.title ?? null },
      });
      if (reward) rewards.push(reward);
    }
  }

  // Snapshot final de XP após eventuais level-up rewards.
  const refreshedUser =
    rewards.length > 0
      ? await tx.user.findUnique({ where: { id: userId } })
      : user;
  const finalXp = refreshedUser?.xp ?? user.xp;

  const idx = levels.findIndex((l) => l.levelNumber === current.levelNumber);
  const next = idx >= 0 ? levels[idx + 1] ?? null : null;

  const view: LevelView = {
    levelNumber: current.levelNumber,
    minXp: current.minXp,
    minCompletedMissions: current.minCompletedMissions,
    title: current.title ?? null,
    iconUrl: current.iconUrl ?? null,
  };

  let progress: LevelProgressView;
  if (!next) {
    progress = {
      percentage: 100,
      currentLevel: current.levelNumber,
      nextLevel: null,
      xp: { current: finalXp, requiredForNext: null },
      missions: { current: completedMissionsCount, requiredForNext: null },
    };
  } else {
    const xpProgress = progressToTarget(finalXp, next.minXp);
    const missionsProgress = progressToTarget(completedMissionsCount, next.minCompletedMissions);
    const percentage = clampPercent((xpProgress + missionsProgress) / 2);
    progress = {
      percentage: Number(percentage.toFixed(2)),
      currentLevel: current.levelNumber,
      nextLevel: next.levelNumber,
      xp: { current: finalXp, requiredForNext: next.minXp },
      missions: { current: completedMissionsCount, requiredForNext: next.minCompletedMissions },
    };
  }

  return { level: view, progress, rewards };
}
