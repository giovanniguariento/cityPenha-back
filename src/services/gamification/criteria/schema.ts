/**
 * Validação Zod recursiva da árvore de critérios.
 * A engine só carrega missões/badges com `criteria` que casa neste schema.
 * Admins recebem erro de validação ao tentar salvar payload inválido.
 */
import { z } from 'zod';
import type { CriteriaNode } from '../types';

export const criteriaOpSchema = z.enum(['>=', '<=', '>', '<', '==', '!=']);

const metricNodeSchema = z.object({
  metric: z.string().min(1),
  params: z.record(z.string(), z.unknown()).nullable().optional(),
  op: criteriaOpSchema,
  value: z.number().finite(),
});

export const criteriaNodeSchema: z.ZodType<CriteriaNode> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(criteriaNodeSchema).min(1) }),
    z.object({ any: z.array(criteriaNodeSchema).min(1) }),
    metricNodeSchema,
  ])
);

/**
 * Tenta parsear um valor desconhecido em uma `CriteriaNode`. Retorna `null` se inválido.
 * Útil porque `Mission.criteria` é `Json?` e chega como `unknown` do banco.
 */
export function parseCriteria(value: unknown): CriteriaNode | null {
  if (value == null) return null;
  const result = criteriaNodeSchema.safeParse(value);
  return result.success ? result.data : null;
}
