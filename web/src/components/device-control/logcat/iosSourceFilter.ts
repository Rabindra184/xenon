import { parseQuery } from './logcatFilter';

/**
 * Turn the filter box's query into `go-ios ostrace` flags.
 *
 * Android streams everything and filters in the browser. iOS cannot: os_trace
 * on an idle iPhone 14 is 5,485 lines/sec at Debug — 97% of it Debug — against
 * ~335/sec for everything else, so the narrowing has to happen at the source or
 * the pane shows little but drop markers.
 *
 * The user never sees this. They use the same level dropdown and the same
 * `package:` term as on Android; the difference is only where the filter is
 * applied, and this is the one place that translation lives.
 */
export interface IOSSourceFilter {
  levels: string[];
  process?: string;
}

/**
 * os_log levels, ascending, paired with the Android level each maps to.
 *
 * Android's `V` and `W` have no os_log peer, and os_log's `Default` (normal
 * priority) has no Android peer — it is reported as `I`, so asking for `I` or
 * `W` yields the same set. The `level:` filter is a minimum, so only the
 * ordering has to survive the round trip.
 */
const ASCENDING: Array<{ ios: string; android: string }> = [
  { ios: 'Debug', android: 'D' },
  { ios: 'Info', android: 'I' },
  { ios: 'Default', android: 'I' },
  { ios: 'Error', android: 'E' },
  { ios: 'Fault', android: 'F' },
];

const ANDROID_ORDER = ['V', 'D', 'I', 'W', 'E', 'F'];

/** Every os_log level at or above the requested Android minimum. */
export function levelsAtOrAbove(minLevel: string | undefined): string[] {
  // No explicit minimum means the default view: everything except Debug.
  // Debug is opt-in because it alone is the difference between a readable
  // pane and a firehose.
  if (!minLevel) return ASCENDING.filter((l) => l.ios !== 'Debug').map((l) => l.ios);

  const floor = ANDROID_ORDER.indexOf(minLevel.toUpperCase());
  if (floor < 0) return ASCENDING.map((l) => l.ios);
  return ASCENDING.filter((l) => ANDROID_ORDER.indexOf(l.android) >= floor).map((l) => l.ios);
}

export function iosSourceFilter(query: string): IOSSourceFilter {
  // Parsed case-sensitively on purpose. The default lowercases values so the
  // browser can match case-insensitively, but this value becomes
  // `--process=…` on a real command line, where `springboard` does not select
  // `SpringBoard`. Local matching keeps its own case-insensitive parse.
  const parsed = parseQuery(query, { caseSensitive: true });
  return {
    levels: levelsAtOrAbove(parsed.minLevel),
    // `package:` selects an app's own logs, which is what ostrace's --process
    // does. Pushed down rather than matched here so a single app at Debug is
    // ~115 lines/sec instead of 5,485.
    process: parsed.pkg || undefined,
  };
}
