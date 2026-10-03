import { LEVEL_ORDER, matches, type LogcatQuery, type LogRecordLike } from './logcatFilter';

/**
 * Lines per level, for the level bar, and the levels each platform offers.
 *
 * Records carry Android's letters on both platforms: iOS's os_log levels are
 * mapped on the server (Debug → D, Info and Default → I, Error → E, Fault →
 * F), so iOS never has V or W.
 */
export type Level = (typeof LEVEL_ORDER)[number];
export type LevelCounts = Record<Level, number>;
export type LogPlatform = 'android' | 'ios';

const LEVELS: readonly Level[] = LEVEL_ORDER;

const NAMES: Record<Level, string> = {
  V: 'Verbose',
  D: 'Debug',
  I: 'Info',
  W: 'Warning',
  E: 'Error',
  F: 'Fatal',
};

/**
 * Lines of each level that pass `query` with its level term removed: the bar
 * shows what each level would show. Xenon's own records are left out (they
 * always show, whatever the level), and so are letters no level has.
 */
export function countLevels(records: readonly LogRecordLike[], query: LogcatQuery): LevelCounts {
  const counts: LevelCounts = { V: 0, D: 0, I: 0, W: 0, E: 0, F: 0 };
  const withoutLevel: LogcatQuery = { ...query, minLevel: undefined };
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.synthetic) continue;
    if (!Object.prototype.hasOwnProperty.call(counts, r.level)) continue;
    if (matches(r, withoutLevel)) counts[r.level as Level] += 1;
  }
  return counts;
}

export interface LevelChoice {
  level: Level;
  name: string;
}

/**
 * The levels a platform's bar offers. Android: Verbose to Error, and Fatal
 * when the buffer holds one or it is the level asked for (or the chosen
 * button would vanish). iOS: what os_log sends.
 */
export function levelChoices(
  platform: LogPlatform,
  counts: LevelCounts,
  minLevel: string | undefined,
): LevelChoice[] {
  const offered: Level[] =
    platform === 'ios'
      ? ['D', 'I', 'E', 'F']
      : counts.F > 0 || (minLevel || '').toUpperCase() === 'F'
        ? ['V', 'D', 'I', 'W', 'E', 'F']
        : ['V', 'D', 'I', 'W', 'E'];
  return offered.map((level) => ({ level, name: levelName(level, platform) }));
}

/**
 * The button a `level:` term presses: the lowest offered level at or above
 * it, so on iOS `level:W` presses Error, whose lines are the ones shown. None
 * for no level, an unknown one, or nothing offered at or above it.
 */
export function chosenLevel(
  choices: readonly LevelChoice[],
  minLevel: string | undefined,
): Level | null {
  if (!minLevel) return null;
  const floor = LEVELS.indexOf(minLevel.toUpperCase() as Level);
  if (floor < 0) return null;
  const choice = choices.find((c) => LEVELS.indexOf(c.level) >= floor);
  return choice ? choice.level : null;
}

/** A level's name: F is Fatal on Android and Fault on iOS. */
export function levelName(level: string, platform: LogPlatform): string {
  if (level === 'F') return platform === 'ios' ? 'Fault' : 'Fatal';
  return NAMES[level as Level] ?? level;
}
