/**
 * Avalia insígnias ativas para um usuário.
 *
 * Regras:
 *  - Critério: árvore custom (`badge.criteria`) OR fallback `metricKey >= threshold`.
 *  - Concedida apenas uma vez (insert no `user_badges`); badges não são revogadas neste design.
 *  - Cada concessão gera linha no ledger com `source = "BADGE:<id>"` para auditoria.
 */
import type { Badge, UserBadge } from '../../../generated/prisma/client';
import type { MetricCache } from '../metrics/registry';
import type { Tx, BadgeView, RewardView } from '../types';
import { parseCriteria } from '../criteria/schema';
import { defaultCriteriaFor, evaluateCriteria } from '../criteria/evaluator';
import { applyReward } from './rewardLedger';

export interface BadgeEvaluationResult {
  views: BadgeView[];
  rewards: RewardView[];
}

export async function evaluateBadges(args: {
  tx: Tx;
  userId: string;
  badges: Badge[];
  cache: MetricCache;
  knownMetricKeys: Set<string>;
}): Promise<BadgeEvaluationResult> {
  const { tx, userId, badges, cache, knownMetricKeys } = args;

  const userBadges = await tx.userBadge.findMany({ where: { userId } });
  const userBadgeByBadgeId = new Map<string, UserBadge>(userBadges.map((ub) => [ub.badgeId, ub]));

  const views: BadgeView[] = [];
  const rewards: RewardView[] = [];

  for (const badge of badges) {
    const earned = userBadgeByBadgeId.get(badge.id);
    let progress: number | null = null;

    const metricParams = (badge.metricParams ?? null) as Record<string, unknown> | null;
    if (badge.metricKey && knownMetricKeys.has(badge.metricKey)) {
      progress = await cache.get(badge.metricKey, metricParams);
    }

    if (earned) {
      views.push(toView(badge, earned, progress));
      continue;
    }

    const customCriteria = parseCriteria(badge.criteria);
    let shouldEarn = false;
    if (customCriteria) {
      const { ok } = await evaluateCriteria(customCriteria, cache);
      shouldEarn = ok;
    } else if (badge.metricKey && knownMetricKeys.has(badge.metricKey) && badge.threshold != null) {
      const fallback = defaultCriteriaFor(badge.metricKey, badge.threshold, metricParams);
      const { ok } = await evaluateCriteria(fallback, cache);
      shouldEarn = ok;
    }

    if (shouldEarn) {
      const created = await tx.userBadge.create({
        data: { userId, badgeId: badge.id },
      });
      // Insígnias podem (futuramente) carregar XP/coins; hoje 0/0 — applyReward retorna null.
      const reward = await applyReward({
        tx,
        userId,
        source: `BADGE:${badge.id}`,
        reason: 'granted',
        coinsDelta: 0,
        xpDelta: 0,
        meta: { badgeKey: badge.key, badgeTitle: badge.title },
      });
      if (reward) rewards.push(reward);
      views.push(toView(badge, created, progress));
    } else {
      views.push(toView(badge, undefined, progress));
    }
  }

  return { views, rewards };
}

function toView(badge: Badge, ub: UserBadge | undefined, progress: number | null): BadgeView {
  return {
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
  };
}
