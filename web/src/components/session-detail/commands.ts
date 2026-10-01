/**
 * What the session detail page works out from a session's command log
 * (GET /session/:id/session_log, one SessionLog row per Appium command,
 * newest first): the counts in the outcome tiles, the healing panel, the
 * timeline and the screenshots.
 */

import type { ISessionLog } from '../../interfaces/ISessionLog';

/**
 * A command log row as these helpers read it. Every field is optional: the
 * log viewer hands its rows over untyped.
 */
export type CommandLog = Partial<ISessionLog> & Record<string, unknown>;

const nameOf = (l: CommandLog) => l.command_name || l.title || 'command';
const timeOf = (l: CommandLog) => {
  const t = l.createdAt ? Date.parse(l.createdAt) : NaN;
  return Number.isFinite(t) ? t : 0;
};
const oldestFirst = <T extends CommandLog>(logs: T[]) =>
  [...logs].sort((a, b) => timeOf(a) - timeOf(b));

/** A command whose response was an error. */
export function isFailedCommand(l: CommandLog): boolean {
  return l.is_success === false || l.is_error === true;
}

export interface CommandStats {
  total: number;
  failed: number;
  healed: number;
  /** The healing tiers used, in the order they were first used. */
  healedTiers: string[];
  slowest: { name: string; ms: number } | null;
  screenshots: number;
}

export function commandStats(logs: CommandLog[]): CommandStats {
  const healedTiers: string[] = [];
  let slowest: CommandStats['slowest'] = null;
  for (const l of oldestFirst(logs)) {
    if (l.is_healed && l.healing_tier && !healedTiers.includes(l.healing_tier)) {
      healedTiers.push(l.healing_tier);
    }
    if (typeof l.duration === 'number' && (!slowest || l.duration > slowest.ms)) {
      slowest = { name: nameOf(l), ms: l.duration };
    }
  }
  return {
    total: logs.length,
    failed: logs.filter(isFailedCommand).length,
    healed: logs.filter((l) => l.is_healed).length,
    healedTiers,
    slowest,
    screenshots: logs.filter((l) => l.screenshot).length,
  };
}

export interface HealedCommand {
  id: string | undefined;
  command: string;
  /** `strategy=selector`, or the selector alone when no strategy is on record. */
  original: string | null;
  healed: string | null;
  tier: string | null;
  /** Percent, 0-100; null when not recorded. */
  confidence: number | null;
  at: string | undefined;
}

const locator = (strategy?: string | null, selector?: string | null) =>
  selector ? (strategy ? `${strategy}=${selector}` : selector) : null;

/** Every healed command, oldest first, with the selector it healed to. */
export function healedCommands(logs: CommandLog[]): HealedCommand[] {
  return oldestFirst(logs.filter((l) => l.is_healed)).map((l) => ({
    id: l.id,
    command: nameOf(l),
    original: locator(l.original_strategy, l.original_selector),
    healed: locator(l.healed_strategy, l.healed_selector),
    tier: l.healing_tier ?? null,
    confidence:
      typeof l.healing_confidence === 'number' ? Math.round(l.healing_confidence * 100) : null,
    at: l.createdAt,
  }));
}

/** A failed command's error, from its W3C error response; null otherwise. */
export function commandErrorMessage(l: CommandLog): string | null {
  if (!l.response) return null;
  try {
    const value = JSON.parse(l.response)?.value;
    if (!value || typeof value !== 'object') return null;
    const message = typeof value.message === 'string' ? value.message.trim() : '';
    if (message) return message;
    return typeof value.error === 'string' && value.error ? value.error : null;
  } catch {
    return null;
  }
}

export interface TimelineBar {
  id: string | undefined;
  label: string;
  /** From the first command's start. */
  startMs: number;
  durationMs: number;
  failed: boolean;
  healed: boolean;
}

/**
 * Each command on one time axis, oldest first. A row is written as its
 * command ends, so a command began `duration` before its row's time.
 */
export function timelineLayout(logs: CommandLog[]): { spanMs: number; bars: TimelineBar[] } {
  if (logs.length === 0) return { spanMs: 0, bars: [] };
  const timed = logs.map((l) => {
    const end = timeOf(l);
    const durationMs = typeof l.duration === 'number' && l.duration > 0 ? l.duration : 0;
    return { l, start: end - durationMs, end, durationMs };
  });
  const t0 = Math.min(...timed.map((t) => t.start));
  const t1 = Math.max(...timed.map((t) => t.end));
  return {
    spanMs: Math.max(1, t1 - t0),
    bars: timed
      .sort((a, b) => a.start - b.start)
      .map(({ l, start, durationMs }) => ({
        id: l.id,
        label: nameOf(l),
        startMs: start - t0,
        durationMs,
        failed: isFailedCommand(l),
        healed: !!l.is_healed,
      })),
  };
}

export interface CommandScreenshot {
  id: string | undefined;
  path: string;
  command: string;
  at: string | undefined;
  failed: boolean;
}

/** The commands that kept a screenshot, oldest first. */
export function screenshotsOf(logs: CommandLog[]): CommandScreenshot[] {
  return oldestFirst(logs.filter((l) => l.screenshot)).map((l) => ({
    id: l.id,
    path: l.screenshot as string,
    command: nameOf(l),
    at: l.createdAt,
    failed: isFailedCommand(l),
  }));
}

/** A command's duration as people say it: "320ms", "8.4s", "1m 12s". */
export function formatCommandDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
