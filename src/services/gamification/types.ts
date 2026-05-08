/**
 * Tipos compartilhados pela engine de gamificação dinâmica.
 */
import type { Prisma } from '../../generated/prisma/client';

/** Cliente Prisma transacional ou raiz; engines aceitam ambos. */
export type Tx = Prisma.TransactionClient;

/**
 * Um nó da árvore de critério persistida em `Mission.criteria` / `Badge.criteria`.
 * Suporta composições aninhadas (`all`/`any`) e folhas referenciando uma métrica.
 */
export type CriteriaNode = AllNode | AnyNode | MetricNode;

export interface AllNode {
  all: CriteriaNode[];
}
export interface AnyNode {
  any: CriteriaNode[];
}

/** Operadores aceitos em uma folha de critério. */
export type CriteriaOp = '>=' | '<=' | '>' | '<' | '==' | '!=';

export interface MetricNode {
  metric: string;
  params?: Record<string, unknown> | null;
  op: CriteriaOp;
  value: number;
}

/** Eventos de domínio publicados pelos controllers via `notify`. */
export type DomainEventType =
  | 'read'
  | 'like.added'
  | 'like.removed'
  | 'save.added'
  | 'save.removed'
  | 'manual_recompute';

export interface DomainEventPayload {
  userId: string;
  wordpressPostId?: number;
  /** IDs WordPress de categorias do post envolvido (necessário para métricas filtradas por categoria). */
  categoryIds?: number[];
  /** Hint para o ledger sobre quem disparou (auditoria). */
  source?: string;
}

/** Resultado do `notify` retornado ao caller (controllers). */
export interface NotifyResult {
  user: GamificationUser;
  completedMissionsCount: number;
  daysWithReads: string[];
  missions: MissionWithProgressView[];
  badges: BadgeView[];
  level: LevelView | null;
  levelProgress: LevelProgressView | null;
  rewards: RewardView[];
}

export interface GamificationUser {
  id: string;
  xp: number;
  coins: number;
}

export interface MissionWithProgressView {
  id: string;
  key: string;
  title: string;
  description: string | null;
  iconUrl: string | null;
  category: string | null;
  metricKey: string;
  target: number;
  coinReward: number;
  xpReward: number;
  progress: number;
  completed: boolean;
  completedAt: string | null;
  isReversible: boolean;
}

export interface BadgeView {
  id: string;
  key: string;
  title: string;
  description: string | null;
  iconUrl: string | null;
  metricKey: string | null;
  threshold: number | null;
  earned: boolean;
  earnedAt: string | null;
  /** Valor atual da métrica primária (se houver), para barra de progresso. */
  progress: number | null;
}

export interface LevelView {
  levelNumber: number;
  minXp: number;
  minCompletedMissions: number;
  title: string | null;
  iconUrl: string | null;
}

export interface LevelProgressView {
  percentage: number;
  currentLevel: number;
  nextLevel: number | null;
  xp: { current: number; requiredForNext: number | null };
  missions: { current: number; requiredForNext: number | null };
}

export interface RewardView {
  source: string;
  reason: 'granted' | 'revoked';
  coinsDelta: number;
  xpDelta: number;
}
