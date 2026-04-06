/** IANA: horário de Brasília (usado na maior parte do Brasil). */
export const BR_TIMEZONE = 'America/Sao_Paulo';

/** Data civil YYYY-MM-DD no fuso do Brasil para o instante dado. */
export function toBrazilYyyyMmDd(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: BR_TIMEZONE });
}

/** Data de hoje (YYYY-MM-DD) no calendário brasileiro. */
export function brazilTodayYyyyMmDd(): string {
  return toBrazilYyyyMmDd(new Date());
}

/**
 * Inclusive start and exclusive end in UTC for filtering `DateTime` columns (e.g. `read_posts.created_at`)
 * to rows whose instant falls on `ymd` in the Brazil calendar.
 *
 * `America/Sao_Paulo` is fixed UTC−3 (no DST). Local midnight BRT on `ymd` is 03:00 UTC that same date;
 * the next Brazil day starts 24h later.
 */
export function brazilDayUtcBounds(ymd: string): { start: Date; endExclusive: Date } {
  const parts = ymd.split('-').map((s) => Number(s.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid Brazil date string: ${ymd}`);
  }
  const [y, m, d] = parts;
  const start = new Date(Date.UTC(y, m - 1, d, 3, 0, 0, 0));
  const endExclusive = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, endExclusive };
}
