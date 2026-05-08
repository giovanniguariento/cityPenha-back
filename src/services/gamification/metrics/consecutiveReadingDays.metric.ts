import type { MetricDescriptor } from './registry';
import { brazilTodayYyyyMmDd, toBrazilYyyyMmDd } from '../../../lib/brTime';

/**
 * Sequência atual de dias consecutivos com leitura, no calendário Brasil.
 * Tolera 1 dia sem leitura: se não leu hoje mas leu ontem, mantém o streak ancorado em ontem.
 */
function shiftYyyyMmDd(ymd: string, dayDelta: number): string {
  const [y, m, d] = ymd.split('-').map((p) => Number(p.trim()));
  if (![y, m, d].every((n) => Number.isFinite(n))) {
    throw new Error(`Invalid date string: ${ymd}`);
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dayDelta);
  return dt.toISOString().slice(0, 10);
}

export function computeCurrentStreak(days: string[], todayYmd = brazilTodayYyyyMmDd()): number {
  if (days.length === 0) return 0;
  const set = new Set(days);
  const yesterday = shiftYyyyMmDd(todayYmd, -1);
  const anchor = set.has(todayYmd) ? todayYmd : set.has(yesterday) ? yesterday : null;
  if (!anchor) return 0;

  let streak = 1;
  let cursor = anchor;
  while (true) {
    const previous = shiftYyyyMmDd(cursor, -1);
    if (!set.has(previous)) break;
    streak += 1;
    cursor = previous;
  }
  return streak;
}

export const consecutiveReadingDaysMetric: MetricDescriptor = {
  key: 'consecutive_reading_days',
  description:
    'Sequência atual de dias consecutivos com pelo menos uma leitura (calendário Brasil, com 1 dia de tolerância).',
  acceptedParams: [],
  handler: async ({ userId, tx }) => {
    const reads = await tx.readPost.findMany({
      where: { userId },
      select: { createdAt: true },
    });
    const days = [...new Set(reads.map((r) => toBrazilYyyyMmDd(r.createdAt)))].sort();
    return computeCurrentStreak(days);
  },
};
