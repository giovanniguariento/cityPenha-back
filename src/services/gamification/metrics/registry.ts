/**
 * Registry centralizado de métricas usadas por missions/badges/levels.
 *
 * Cada métrica é uma função pura `(ctx) => Promise<number>` registrada por chave.
 * Adicionar uma nova métrica = importar e chamar `registerMetric(...)` em `metrics/index.ts`.
 *
 * O `MetricCache` evita recomputar a mesma métrica + params dentro de uma única
 * notificação (ex.: 5 missões usando `total_reads` = 1 query, não 5).
 */
import type { Tx } from '../types';

export interface MetricContext {
  userId: string;
  params: Record<string, unknown> | null | undefined;
  tx: Tx;
}

export type MetricHandler = (ctx: MetricContext) => Promise<number>;

export interface MetricDescriptor {
  key: string;
  description: string;
  /** Lista de chaves de `params` aceitas (para introspecção pelo admin). */
  acceptedParams: string[];
  handler: MetricHandler;
}

const registry = new Map<string, MetricDescriptor>();

export function registerMetric(descriptor: MetricDescriptor): void {
  if (registry.has(descriptor.key)) {
    throw new Error(`Metric "${descriptor.key}" is already registered`);
  }
  registry.set(descriptor.key, descriptor);
}

export function getMetricDescriptor(key: string): MetricDescriptor | null {
  return registry.get(key) ?? null;
}

export function listMetricDescriptors(): MetricDescriptor[] {
  return [...registry.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function listMetricKeys(): string[] {
  return [...registry.keys()].sort();
}

/** Hash estável de params para servir como chave de cache. */
export function hashParams(params: Record<string, unknown> | null | undefined): string {
  if (!params) return '';
  const keys = Object.keys(params).sort();
  return keys.map((k) => `${k}=${JSON.stringify(params[k])}`).join('|');
}

/**
 * Cache de métricas com escopo de "uma notificação".
 * Reinicializado a cada `notify(...)` para refletir mudanças intermediárias do mesmo fluxo.
 */
export class MetricCache {
  private cache = new Map<string, number>();

  constructor(
    private readonly userId: string,
    private readonly tx: Tx
  ) {}

  private cacheKey(metric: string, params: Record<string, unknown> | null | undefined): string {
    return `${metric}::${hashParams(params)}`;
  }

  async get(metric: string, params: Record<string, unknown> | null | undefined): Promise<number> {
    const key = this.cacheKey(metric, params);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const descriptor = getMetricDescriptor(metric);
    if (!descriptor) {
      throw new Error(`Unknown metric "${metric}"`);
    }
    const value = await descriptor.handler({ userId: this.userId, params, tx: this.tx });
    this.cache.set(key, value);
    return value;
  }

  invalidate(metric: string, params?: Record<string, unknown> | null): void {
    if (params === undefined) {
      for (const k of [...this.cache.keys()]) {
        if (k.startsWith(`${metric}::`)) this.cache.delete(k);
      }
      return;
    }
    this.cache.delete(this.cacheKey(metric, params));
  }

  invalidateAll(): void {
    this.cache.clear();
  }
}
