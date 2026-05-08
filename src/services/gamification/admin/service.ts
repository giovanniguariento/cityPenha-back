/**
 * Lógica CRUD da API admin de gamificação.
 * Validações estruturais ficam nos schemas Zod (ver `./schemas.ts`); aqui validamos
 * regras dependentes de runtime (ex.: `metricKey` precisa existir no registry).
 */
import { prisma } from '../../../lib/prisma';
import { listMetricKeys, listMetricDescriptors, MetricCache } from '../metrics/index';
import { parseCriteria } from '../criteria/schema';
import { defaultCriteriaFor, evaluateCriteria } from '../criteria/evaluator';
import type { CriteriaNode } from '../types';
import type {
  BadgeCreateInput,
  BadgeUpdateInput,
  LevelCreateInput,
  LevelUpdateInput,
  MissionCreateInput,
  MissionUpdateInput,
} from './schemas';

export class AdminGamificationService {
  private knownMetricKeys(): Set<string> {
    return new Set(listMetricKeys());
  }

  private assertMetricKey(metricKey: string): void {
    if (!this.knownMetricKeys().has(metricKey)) {
      throw new Error(`Unknown metricKey "${metricKey}"`);
    }
  }

  /** Verifica recursivamente que toda métrica referenciada na árvore está registrada. */
  private assertCriteriaMetrics(node: CriteriaNode | null | undefined): void {
    if (!node) return;
    const known = this.knownMetricKeys();
    const walk = (n: CriteriaNode): void => {
      if ('all' in n) n.all.forEach(walk);
      else if ('any' in n) n.any.forEach(walk);
      else if ('metric' in n && !known.has(n.metric)) {
        throw new Error(`Unknown metricKey "${n.metric}" in criteria`);
      }
    };
    walk(node);
  }

  // ─── Métricas (introspecção) ────────────────────────────────────────────────

  listMetrics() {
    return listMetricDescriptors().map((d) => ({
      key: d.key,
      description: d.description,
      acceptedParams: d.acceptedParams,
    }));
  }

  // ─── Missões ────────────────────────────────────────────────────────────────

  listMissions() {
    return prisma.mission.findMany({ orderBy: { key: 'asc' } });
  }

  getMission(id: string) {
    return prisma.mission.findUnique({ where: { id } });
  }

  async createMission(input: MissionCreateInput) {
    this.assertMetricKey(input.metricKey);
    this.assertCriteriaMetrics(input.criteria as CriteriaNode | null | undefined);
    return prisma.mission.create({
      data: {
        key: input.key,
        title: input.title,
        description: input.description ?? null,
        iconUrl: input.iconUrl ?? null,
        category: input.category ?? null,
        isActive: input.isActive ?? true,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        metricKey: input.metricKey,
        metricParams: (input.metricParams ?? null) as never,
        target: input.target,
        criteria: (input.criteria ?? null) as never,
        coinReward: input.coinReward ?? 0,
        xpReward: input.xpReward ?? 0,
        isReversible: input.isReversible ?? false,
      },
    });
  }

  async updateMission(id: string, input: MissionUpdateInput) {
    if (input.metricKey) this.assertMetricKey(input.metricKey);
    if (input.criteria !== undefined) {
      this.assertCriteriaMetrics(input.criteria as CriteriaNode | null | undefined);
    }
    return prisma.mission.update({
      where: { id },
      data: {
        ...(input.key !== undefined ? { key: input.key } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.iconUrl !== undefined ? { iconUrl: input.iconUrl } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.startsAt !== undefined
          ? { startsAt: input.startsAt ? new Date(input.startsAt) : null }
          : {}),
        ...(input.endsAt !== undefined
          ? { endsAt: input.endsAt ? new Date(input.endsAt) : null }
          : {}),
        ...(input.metricKey !== undefined ? { metricKey: input.metricKey } : {}),
        ...(input.metricParams !== undefined
          ? { metricParams: (input.metricParams ?? null) as never }
          : {}),
        ...(input.target !== undefined ? { target: input.target } : {}),
        ...(input.criteria !== undefined ? { criteria: (input.criteria ?? null) as never } : {}),
        ...(input.coinReward !== undefined ? { coinReward: input.coinReward } : {}),
        ...(input.xpReward !== undefined ? { xpReward: input.xpReward } : {}),
        ...(input.isReversible !== undefined ? { isReversible: input.isReversible } : {}),
      },
    });
  }

  async deleteMission(id: string) {
    return prisma.mission.delete({ where: { id } });
  }

  /**
   * Dry-run: avalia o critério da missão para um usuário e devolve métricas observadas
   * sem aplicar progresso/recompensa. Essencial antes de ativar uma missão nova.
   */
  async previewMission(missionId: string, userId: string) {
    const mission = await prisma.mission.findUnique({ where: { id: missionId } });
    if (!mission) return null;

    const cache = new MetricCache(userId, prisma);
    const metricParams = (mission.metricParams ?? null) as Record<string, unknown> | null;
    const knownMetricKeys = this.knownMetricKeys();

    const primaryValue = knownMetricKeys.has(mission.metricKey)
      ? await cache.get(mission.metricKey, metricParams)
      : null;
    const progress =
      primaryValue == null ? 0 : Math.max(0, Math.min(primaryValue, mission.target));

    const criteria =
      parseCriteria(mission.criteria) ?? defaultCriteriaFor(mission.metricKey, mission.target, metricParams);
    const { ok, observed } = await evaluateCriteria(criteria, cache);

    return {
      missionId,
      missionKey: mission.key,
      userId,
      target: mission.target,
      primaryMetric: mission.metricKey,
      primaryValue,
      progress,
      wouldComplete: ok,
      observedMetrics: observed,
    };
  }

  // ─── Insígnias ──────────────────────────────────────────────────────────────

  listBadges() {
    return prisma.badge.findMany({ orderBy: { key: 'asc' } });
  }

  getBadge(id: string) {
    return prisma.badge.findUnique({ where: { id } });
  }

  async createBadge(input: BadgeCreateInput) {
    if (input.metricKey) this.assertMetricKey(input.metricKey);
    this.assertCriteriaMetrics(input.criteria as CriteriaNode | null | undefined);
    return prisma.badge.create({
      data: {
        key: input.key,
        title: input.title,
        description: input.description ?? null,
        iconUrl: input.iconUrl ?? null,
        metricKey: input.metricKey ?? null,
        metricParams: (input.metricParams ?? null) as never,
        threshold: input.threshold ?? null,
        criteria: (input.criteria ?? null) as never,
        isActive: input.isActive ?? true,
      },
    });
  }

  async updateBadge(id: string, input: BadgeUpdateInput) {
    if (input.metricKey) this.assertMetricKey(input.metricKey);
    if (input.criteria !== undefined) {
      this.assertCriteriaMetrics(input.criteria as CriteriaNode | null | undefined);
    }
    return prisma.badge.update({
      where: { id },
      data: {
        ...(input.key !== undefined ? { key: input.key } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.iconUrl !== undefined ? { iconUrl: input.iconUrl } : {}),
        ...(input.metricKey !== undefined ? { metricKey: input.metricKey } : {}),
        ...(input.metricParams !== undefined
          ? { metricParams: (input.metricParams ?? null) as never }
          : {}),
        ...(input.threshold !== undefined ? { threshold: input.threshold } : {}),
        ...(input.criteria !== undefined ? { criteria: (input.criteria ?? null) as never } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  }

  async deleteBadge(id: string) {
    return prisma.badge.delete({ where: { id } });
  }

  // ─── Levels ─────────────────────────────────────────────────────────────────

  listLevels() {
    return prisma.level.findMany({ orderBy: { levelNumber: 'asc' } });
  }

  getLevel(id: string) {
    return prisma.level.findUnique({ where: { id } });
  }

  async createLevel(input: LevelCreateInput) {
    return prisma.level.create({
      data: {
        levelNumber: input.levelNumber,
        minXp: input.minXp ?? 0,
        minCompletedMissions: input.minCompletedMissions ?? 0,
        title: input.title ?? null,
        iconUrl: input.iconUrl ?? null,
        rewardCoins: input.rewardCoins ?? 0,
        rewardXp: input.rewardXp ?? 0,
      },
    });
  }

  async updateLevel(id: string, input: LevelUpdateInput) {
    return prisma.level.update({
      where: { id },
      data: {
        ...(input.levelNumber !== undefined ? { levelNumber: input.levelNumber } : {}),
        ...(input.minXp !== undefined ? { minXp: input.minXp } : {}),
        ...(input.minCompletedMissions !== undefined
          ? { minCompletedMissions: input.minCompletedMissions }
          : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.iconUrl !== undefined ? { iconUrl: input.iconUrl } : {}),
        ...(input.rewardCoins !== undefined ? { rewardCoins: input.rewardCoins } : {}),
        ...(input.rewardXp !== undefined ? { rewardXp: input.rewardXp } : {}),
      },
    });
  }

  async deleteLevel(id: string) {
    return prisma.level.delete({ where: { id } });
  }

  // ─── Ledger / auditoria ─────────────────────────────────────────────────────

  /**
   * Histórico paginado de grants/revokes para um usuário, mais recente primeiro.
   * Usado em telas admin/analytics para investigar disputas ou bugs de gamificação.
   */
  async listLedgerForUser(userId: string, opts: { limit?: number; cursor?: string } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    return prisma.rewardLedger.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
    });
  }
}

export const adminGamificationService = new AdminGamificationService();
