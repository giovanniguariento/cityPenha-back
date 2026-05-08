/**
 * Avaliador recursivo de árvores de critério.
 * Resolve métricas via `MetricCache` para evitar requeries dentro da mesma notificação.
 */
import type { CriteriaNode, CriteriaOp, MetricNode } from '../types';
import type { MetricCache } from '../metrics/registry';

function compare(left: number, op: CriteriaOp, right: number): boolean {
  switch (op) {
    case '>=':
      return left >= right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '<':
      return left < right;
    case '==':
      return left === right;
    case '!=':
      return left !== right;
  }
}

function isAll(node: CriteriaNode): node is { all: CriteriaNode[] } {
  return Object.prototype.hasOwnProperty.call(node, 'all');
}
function isAny(node: CriteriaNode): node is { any: CriteriaNode[] } {
  return Object.prototype.hasOwnProperty.call(node, 'any');
}
function isMetric(node: CriteriaNode): node is MetricNode {
  return Object.prototype.hasOwnProperty.call(node, 'metric');
}

/**
 * Avalia a árvore retornando boolean + valores observados de cada métrica
 * (útil para preview/debug e para o snapshot enviado ao frontend).
 */
export async function evaluateCriteria(
  node: CriteriaNode,
  cache: MetricCache
): Promise<{ ok: boolean; observed: Record<string, number> }> {
  const observed: Record<string, number> = {};

  async function walk(n: CriteriaNode): Promise<boolean> {
    if (isAll(n)) {
      for (const child of n.all) {
        if (!(await walk(child))) return false;
      }
      return true;
    }
    if (isAny(n)) {
      for (const child of n.any) {
        if (await walk(child)) return true;
      }
      return false;
    }
    if (isMetric(n)) {
      const value = await cache.get(n.metric, n.params ?? null);
      const obsKey = `${n.metric}${n.params ? ':' + JSON.stringify(n.params) : ''}`;
      observed[obsKey] = value;
      return compare(value, n.op, n.value);
    }
    return false;
  }

  const ok = await walk(node);
  return { ok, observed };
}

/**
 * Constrói uma árvore "padrão" para o caso comum em que a Mission/Badge não tem `criteria`
 * customizado: usa apenas a métrica primária + threshold.
 */
export function defaultCriteriaFor(metricKey: string, target: number, params: Record<string, unknown> | null): CriteriaNode {
  return { metric: metricKey, params, op: '>=', value: target };
}
