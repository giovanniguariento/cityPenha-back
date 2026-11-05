import { BR_TIMEZONE } from '../lib/brTime';

const MONTHS_PT = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

type BrParts = {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
};

function brazilParts(d: Date): BrParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: BR_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });
  const bag: Partial<BrParts> = {};
  for (const part of fmt.formatToParts(d)) {
    if (part.type === 'year') bag.year = Number(part.value);
    if (part.type === 'month') bag.month = Number(part.value);
    if (part.type === 'day') bag.day = Number(part.value);
    if (part.type === 'hour') bag.hour = Number(part.value);
    if (part.type === 'minute') bag.minute = Number(part.value);
  }
  return {
    year: bag.year!,
    month: bag.month!,
    day: bag.day!,
    hour: bag.hour!,
    minute: bag.minute!,
  };
}

function dayMonthYear(p: BrParts): string {
  return `${p.day} de ${MONTHS_PT[p.month - 1]} de ${p.year}`;
}

function dayMonth(p: BrParts): string {
  return `${p.day} de ${MONTHS_PT[p.month - 1]}`;
}

/** Clock label in PT-BR, e.g. `10h`, `10h30`. */
export function formatExperienceClock(d: Date): string {
  const { hour, minute } = brazilParts(d);
  if (minute === 0) return `${hour}h`;
  return `${hour}h${String(minute).padStart(2, '0')}`;
}

/**
 * Human-readable time range from start/end datetimes (Brazil timezone).
 * Examples: `10h`, `10h às 19h`, `10h30 às 18h`.
 */
export function formatExperienceTimeLabel(startsAt: Date, endsAt: Date | null): string {
  const startClock = formatExperienceClock(startsAt);
  if (!endsAt) return startClock;
  const endClock = formatExperienceClock(endsAt);
  if (startClock === endClock) return startClock;
  return `${startClock} às ${endClock}`;
}

/** Human-readable date range for experience cards (Brazil calendar days). */
export function formatExperienceDateLabel(startsAt: Date, endsAt: Date | null): string {
  const start = brazilParts(startsAt);
  if (!endsAt) {
    return dayMonthYear(start);
  }
  const end = brazilParts(endsAt);
  if (start.year === end.year && start.month === end.month && start.day === end.day) {
    return dayMonthYear(start);
  }
  const sameMonth = start.year === end.year && start.month === end.month;
  const sameYear = start.year === end.year;

  if (sameMonth) {
    return `${start.day} à ${end.day} de ${MONTHS_PT[start.month - 1]} de ${start.year}`;
  }
  if (sameYear) {
    return `${dayMonth(start)} à ${dayMonth(end)} de ${start.year}`;
  }
  return `${dayMonthYear(start)} à ${dayMonthYear(end)}`;
}

export function slugifyExperienceTitle(title: string): string {
  const base = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
  return base || 'experiencia';
}

export function parseTagsInput(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return parseTagsInput(parsed);
    } catch {
      // comma-separated
    }
    return trimmed
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20);
  }
  return [];
}
