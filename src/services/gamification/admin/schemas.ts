/**
 * Zod schemas dos payloads admin (CRUD de Mission/Badge/Level + helpers).
 * Centralizar evita drift entre validação e tipos derivados (`z.infer<...>`).
 */
import { z } from 'zod';
import { criteriaNodeSchema } from '../criteria/schema';

const isoDateSchema = z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
  message: 'Invalid ISO date string',
});

const slugLikeKey = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_]+$/, 'must be lowercase, digits and underscores only');

export const missionCreateSchema = z.object({
  key: slugLikeKey,
  title: z.string().min(1).max(191),
  description: z.string().max(2000).nullable().optional(),
  iconUrl: z.string().url().max(191).nullable().optional(),
  category: z.string().max(64).nullable().optional(),
  isActive: z.boolean().optional(),
  startsAt: isoDateSchema.nullable().optional(),
  endsAt: isoDateSchema.nullable().optional(),
  metricKey: z.string().min(1).max(64),
  metricParams: z.record(z.string(), z.unknown()).nullable().optional(),
  target: z.number().int().positive(),
  criteria: criteriaNodeSchema.nullable().optional(),
  coinReward: z.number().int().min(0).optional(),
  xpReward: z.number().int().min(0).optional(),
  isReversible: z.boolean().optional(),
});

export const missionUpdateSchema = missionCreateSchema.partial();

export const badgeCreateSchema = z
  .object({
    key: slugLikeKey,
    title: z.string().min(1).max(191),
    description: z.string().max(2000).nullable().optional(),
    iconUrl: z.string().url().max(191).nullable().optional(),
    metricKey: z.string().max(64).nullable().optional(),
    metricParams: z.record(z.string(), z.unknown()).nullable().optional(),
    threshold: z.number().int().min(0).nullable().optional(),
    criteria: criteriaNodeSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (b) => (b.metricKey && b.threshold != null) || b.criteria,
    'Provide either (metricKey + threshold) or a criteria tree'
  );

export const badgeUpdateSchema = z.object({
  key: slugLikeKey.optional(),
  title: z.string().min(1).max(191).optional(),
  description: z.string().max(2000).nullable().optional(),
  iconUrl: z.string().url().max(191).nullable().optional(),
  metricKey: z.string().max(64).nullable().optional(),
  metricParams: z.record(z.string(), z.unknown()).nullable().optional(),
  threshold: z.number().int().min(0).nullable().optional(),
  criteria: criteriaNodeSchema.nullable().optional(),
  isActive: z.boolean().optional(),
});

export const levelCreateSchema = z.object({
  levelNumber: z.number().int().positive(),
  minXp: z.number().int().min(0).optional(),
  minCompletedMissions: z.number().int().min(0).optional(),
  title: z.string().max(191).nullable().optional(),
  iconUrl: z.string().url().max(191).nullable().optional(),
  rewardCoins: z.number().int().min(0).optional(),
  rewardXp: z.number().int().min(0).optional(),
});

export const levelUpdateSchema = levelCreateSchema.partial();

export const previewBodySchema = z.object({
  userId: z.string().min(1),
});

export type MissionCreateInput = z.infer<typeof missionCreateSchema>;
export type MissionUpdateInput = z.infer<typeof missionUpdateSchema>;
export type BadgeCreateInput = z.infer<typeof badgeCreateSchema>;
export type BadgeUpdateInput = z.infer<typeof badgeUpdateSchema>;
export type LevelCreateInput = z.infer<typeof levelCreateSchema>;
export type LevelUpdateInput = z.infer<typeof levelUpdateSchema>;
