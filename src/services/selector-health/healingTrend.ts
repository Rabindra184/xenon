/** One day, in milliseconds. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Heals found by a screenshot model or a language model: the slowest and least certain. */
export const AI_METHODS: ReadonlySet<string> = new Set(['Visual AI', 'LLM']);

/** The furthest any time zone is from UTC, in minutes. */
const MAX_OFFSET_MIN = 14 * 60;

/**
 * The caller's offset from UTC in minutes, east positive, from `?tz=` (the
 * browser's `-getTimezoneOffset()`). 0 when absent or not a whole number of
 * minutes within ±14 hours.
 */
export function parseTzOffset(raw: unknown): number {
  if (typeof raw !== 'string' || !/^-?\d+$/.test(raw)) return 0;
  const n = Number(raw);
  return Math.abs(n) <= MAX_OFFSET_MIN ? n : 0;
}

/** The instant the caller's local day holding `ms` began. */
export function localDayStart(ms: number, tzOffsetMin: number): number {
  const shift = tzOffsetMin * 60_000;
  return Math.floor((ms + shift) / DAY_MS) * DAY_MS - shift;
}

export interface TrendDay {
  /** When the caller's local day began. */
  t: number;
  heals: number;
  aiHeals: number;
}

/**
 * Heals per local day, from the day holding `since` to the day holding `now`,
 * days with none included. One fixed offset for the whole period: across a
 * daylight-saving change a heal near midnight can land on the next day.
 */
export function dailyHeals(
  heals: Array<{ at: Date; method: string | null }>,
  since: Date,
  now: Date,
  tzOffsetMin: number,
): TrendDay[] {
  const first = localDayStart(since.getTime(), tzOffsetMin);
  const last = localDayStart(now.getTime(), tzOffsetMin);
  const days: TrendDay[] = [];
  for (let t = first; t <= last; t += DAY_MS) days.push({ t, heals: 0, aiHeals: 0 });
  for (const h of heals) {
    const i = Math.round((localDayStart(h.at.getTime(), tzOffsetMin) - first) / DAY_MS);
    if (i < 0 || i >= days.length) continue;
    days[i].heals += 1;
    if (h.method && AI_METHODS.has(h.method)) days[i].aiHeals += 1;
  }
  return days;
}
