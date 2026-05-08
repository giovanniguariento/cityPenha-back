/**
 * Ponto único de registro das métricas built-in.
 * Importe este módulo uma vez no boot da app para popular o registry.
 */
import { registerMetric, listMetricDescriptors, listMetricKeys, getMetricDescriptor } from './registry';
import { totalReadsMetric } from './totalReads.metric';
import { totalLikesMetric } from './totalLikes.metric';
import { totalSavesMetric } from './totalSaves.metric';
import { consecutiveReadingDaysMetric } from './consecutiveReadingDays.metric';
import { categoryReadsMetric } from './categoryReads.metric';
import { missionsCompletedMetric } from './missionsCompleted.metric';
import { xpMetric, coinsMetric, currentLevelMetric } from './userScalar.metric';

let registered = false;

export function registerBuiltInMetrics(): void {
  if (registered) return;
  registerMetric(totalReadsMetric);
  registerMetric(totalLikesMetric);
  registerMetric(totalSavesMetric);
  registerMetric(consecutiveReadingDaysMetric);
  registerMetric(categoryReadsMetric);
  registerMetric(missionsCompletedMetric);
  registerMetric(xpMetric);
  registerMetric(coinsMetric);
  registerMetric(currentLevelMetric);
  registered = true;
}

export { listMetricDescriptors, listMetricKeys, getMetricDescriptor };
export { MetricCache } from './registry';
