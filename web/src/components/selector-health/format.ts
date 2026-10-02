import { formatStrategy } from '../../utils/strategy-labels';
import {
  ISelectorActivity,
  ISelectorPerson,
  ISelectorStateView,
  SelectorEventAction,
  SelectorSort,
  SelectorTab,
} from '../../interfaces/IHealingEvent';

export type Tone = 'good' | 'bad' | 'neutral';

export const TAB_LABELS: Record<SelectorTab, string> = {
  fix: 'To fix',
  verifying: 'Being verified',
  fixed: 'Fixed',
  muted: 'Muted',
};

export const SORT_LABELS: Record<SelectorSort, string> = {
  heals: 'Most heals',
  recent: 'Most recent',
  time: 'Most time spent healing',
};

/** Healing methods in the order Xenon tries them. */
export const METHODS = ['Resilio', 'Native', 'Fuzzy XML', 'OCR', 'Visual AI', 'LLM'] as const;

export const METHOD_EXPLANATIONS: Record<string, string> = {
  Resilio: 'Found it from its saved fingerprint',
  Native: 'Found it again with the original selector',
  'Fuzzy XML': "Found the closest match in the screen's structure",
  OCR: 'Found it by reading the text on screen',
  'Visual AI': 'Found it in a screenshot with AI',
  LLM: 'Asked a language model to find it',
};

export const PLATFORMS = [
  { value: 'android', label: 'Android' },
  { value: 'ios', label: 'iOS' },
  { value: 'tvos', label: 'tvOS' },
];

/** How long, in the largest unit that reads well. */
export function formatDuration(ms: number): string {
  if (!(ms > 0)) return '0 s';
  const s = ms / 1000;
  if (s < 1) return '<1 s';
  if (Math.round(s) < 60) return `${Math.round(s)} s`;
  const min = s / 60;
  if (Math.round(min) < 60) return `${Math.round(min)} min`;
  const h = min / 60;
  return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
}

export function formatRelative(iso: string | null, now = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const min = Math.floor(Math.max(0, now - t) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** A day on a chart, e.g. "Tue, 30 Sep". */
export function formatDay(t: number): string {
  return new Date(t).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** A date in a list, e.g. "12 Sep 2026". */
export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** This period against the one before, in words; fewer is good. */
export function compareNote(
  current: number,
  prior: number,
  days: number,
  kind: 'count' | 'percent' | 'duration',
): { text: string; tone: Tone } {
  const before = `the ${days} days before`;
  if (current === prior) return { text: `Same as ${before}`, tone: 'neutral' };
  if (prior === 0) return { text: `None ${before}`, tone: 'bad' };
  const up = current > prior;
  const tone: Tone = up ? 'bad' : 'good';
  if (kind === 'count') {
    return { text: `${Math.abs(current - prior)} ${up ? 'more' : 'fewer'} than ${before}`, tone };
  }
  if (kind === 'duration') {
    return {
      text: `${formatDuration(Math.abs(current - prior))} ${up ? 'more' : 'less'} than ${before}`,
      tone,
    };
  }
  const pct = Math.round((Math.abs(current - prior) / prior) * 100);
  if (pct === 0) return { text: `About the same as ${before}`, tone: 'neutral' };
  return { text: `${pct}% ${up ? 'more' : 'fewer'} than ${before}`, tone };
}

export function shareText(share: number): string {
  return `${Math.round(share * 100)}% of heals`;
}

/** A selector's type, e.g. "XPath"; a heal recorded with no strategy has none. */
export function strategyLabel(strategy: string | null): string {
  return strategy ? formatStrategy(strategy) : 'Unknown type';
}

export function statusText(state: ISelectorStateView | null): string {
  switch (state?.status) {
    case 'pending':
      return `Being verified, ${state.cleanBuilds} of 3 clean builds`;
    case 'resolved':
      return 'Fixed';
    case 'muted':
      return 'Muted';
    default:
      return 'To fix';
  }
}

/** " by Priya", or nothing when nobody known did it. Never an id. */
export function personText(p: ISelectorPerson | null): string {
  return p?.name ? ` by ${p.name}` : '';
}

const ACTION_TEXT: Record<SelectorEventAction, string> = {
  marked_fixed: 'Marked fixed',
  verification_cancelled: 'Verification cancelled',
  verified: 'Verified after 3 clean builds',
  broke_again: 'Broke again',
  muted: 'Muted',
  unmuted: 'Unmuted',
};

export function activityText(a: ISelectorActivity): string {
  return `${ACTION_TEXT[a.action] ?? 'Changed'}${personText(a.by)}`;
}
