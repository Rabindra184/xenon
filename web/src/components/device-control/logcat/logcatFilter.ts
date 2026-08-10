/**
 * Client-side log filtering.
 *
 * Deliberately not server-side: one `adb logcat` process serves every viewer
 * of a device, so pushing a level down to logcat's own `*:D` spec would
 * silently change what other viewers see. Filtering instead runs here, over
 * the buffer already delivered to this client — instant, no round trip.
 *
 * Two records the wire type (`LogcatRecord` in
 * `src/services/logcat/logcatParse.ts`) carries that this module deliberately
 * does *not* special-case:
 *
 * - `pkg` is absent whenever the PID couldn't be resolved to a process name
 *   (a short-lived process, a failing `adb shell ps`). A `package:` term
 *   never matches such a record — see `matches` below. `?? ''` makes that
 *   explicit rather than relying on the query value happening to be
 *   non-empty (it always is: an empty-value `package:` token falls through
 *   `parseQuery` to a bare word, never becomes `q.pkg`).
 * - `synthetic` (records Xenon injects itself — a dropped-lines warning, an
 *   end-of-stream marker) ALWAYS matches, checked first in `matches`,
 *   unconditionally, regardless of the active query. This is the opposite of
 *   an earlier decision to filter them like any other record. Reversed
 *   because the multiplexer cannot know what level the dropped lines were:
 *   a reader running `level:E` could have the W-level "N lines dropped (slow
 *   client)" marker hidden and believe every error was captured while errors
 *   were silently discarded — exactly the failure the marker exists to
 *   prevent, reintroduced at the last layer. Dropped records must be visible;
 *   a missing log line is data loss the reader cannot detect otherwise.
 *   Applies to the end-of-stream marker too: its information is arguably
 *   duplicated by the connection pill, but the record carries no
 *   marker-kind discriminator, so exempting one marker but not the other
 *   would mean sniffing level/tag text — fragile. An occasional harmless
 *   "log stream ended" line surviving a `tag:Wifi` filter is the cheaper
 *   mistake.
 */
export const LEVEL_ORDER = ['V', 'D', 'I', 'W', 'E', 'F'] as const;

export interface LogRecordLike {
  level: string;
  tag: string;
  message: string;
  pkg?: string;
  /**
   * True for records Xenon injects itself rather than reads from the device
   * (a dropped-lines warning, an end-of-stream marker). Always matches,
   * regardless of the active query — see `matches` below.
   */
  synthetic?: boolean;
}

export interface LogcatQuery {
  minLevel?: string;
  tag?: string;
  pkg?: string;
  text?: string;
  /**
   * Whether `tag`/`pkg`/`text` above were left in their typed case.
   *
   * Carried on the query rather than passed separately to `matches` on
   * purpose: the two halves must agree. `parseQuery` normalises the needle and
   * `matches` normalises the haystack, so a query parsed case-insensitively
   * (needle lowercased) but matched case-sensitively (haystack not) silently
   * stops matching anything with a capital in it. Keeping the flag on the
   * value it describes makes that pairing impossible to get wrong.
   */
  caseSensitive?: boolean;
}

export interface ParseOptions {
  /** Default false — `tag:wifi` finds `WifiService`, as Android Studio does. */
  caseSensitive?: boolean;
}

/**
 * Parse a query string into its structured form. Grammar (all terms ANDed):
 *
 *   level:W                minimum level (V < D < I < W < E < F)
 *   tag:Wifi                case-insensitive substring on tag
 *   package:com.example     case-insensitive substring on pkg
 *   bare words               case-insensitive substring on message
 *
 * `key:` prefixes are matched case-insensitively; unrecognized `key:value`
 * tokens (including a `level:`/`tag:`/`package:` typed with no value) fall
 * through to the bare-word bucket rather than being dropped, so a malformed
 * term degrades to a text search instead of silently vanishing.
 *
 * `caseSensitive` applies to the VALUES only — the `tag:`/`package:`/`level:`
 * keys themselves are always case-insensitive, and `level:` values are always
 * upper-cased, because a level is an enum rather than text being searched.
 */
export function parseQuery(raw: string, opts: ParseOptions = {}): LogcatQuery {
  const cs = opts.caseSensitive === true;
  const norm = (s: string) => (cs ? s : s.toLowerCase());
  const q: LogcatQuery = cs ? { caseSensitive: true } : {};
  const words: string[] = [];
  for (const token of raw.trim().split(/\s+/).filter(Boolean)) {
    const [key, ...rest] = token.split(':');
    const value = rest.join(':');
    if (value && key.toLowerCase() === 'level') q.minLevel = value.toUpperCase();
    else if (value && key.toLowerCase() === 'tag') q.tag = norm(value);
    else if (value && key.toLowerCase() === 'package') q.pkg = norm(value);
    else words.push(token);
  }
  if (words.length) q.text = norm(words.join(' '));
  return q;
}

export function matches(r: LogRecordLike, q: LogcatQuery): boolean {
  // Dropped-lines and end-of-stream markers must always be visible: the
  // multiplexer cannot know what level the dropped lines were, so hiding
  // this marker behind an active filter would hide the only evidence that
  // lines were lost. Checked first, unconditionally, for both marker kinds.
  if (r.synthetic) return true;
  if (q.minLevel) {
    const want = LEVEL_ORDER.indexOf(q.minLevel as (typeof LEVEL_ORDER)[number]);
    const have = LEVEL_ORDER.indexOf(r.level as (typeof LEVEL_ORDER)[number]);
    // An unrecognized minLevel or record level (index -1) never filters
    // anything out, rather than throwing or matching nothing.
    if (want >= 0 && have >= 0 && have < want) return false;
  }
  // Must use the same normalisation parseQuery applied to the needle — see
  // LogcatQuery.caseSensitive. Reading the flag off the query rather than a
  // separate argument is what keeps the two halves from drifting apart.
  const norm = (s: string) => (q.caseSensitive ? s : s.toLowerCase());
  if (q.tag && !norm(r.tag).includes(q.tag)) return false;
  if (q.pkg && !norm(r.pkg ?? '').includes(q.pkg)) return false;
  if (q.text && !norm(r.message).includes(q.text)) return false;
  return true;
}

/**
 * Insert or replace the `level:` term in a raw query string, leaving every
 * other term untouched, and drop it entirely for a falsy `level`.
 *
 * Exists so a level dropdown can write into the *same* query string the
 * free-text box shows and edits ("the control and the text box cannot
 * disagree"): a naive `` `level:${level} ${query}` `` prepend does not give
 * that guarantee, because a user-typed `level:` term later in the string
 * wins under `parseQuery`'s last-token-wins tokenizing, silently
 * contradicting the dropdown. Routing every level change through this
 * function keeps exactly one `level:` term in the string, sourced from the
 * control, without Task 7 re-implementing the tokenizer above.
 */
export function setLevelTerm(query: string, level: string): string {
  const rest = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => {
      const [key, ...restParts] = token.split(':');
      const value = restParts.join(':');
      // Mirror parseQuery's own `value &&` gate: only a `level:<value>` term
      // is a level term. A bare `level` word (no colon, or a colon with
      // nothing after it) is text the user typed, not a filter control, and
      // must survive a dropdown-driven rewrite untouched.
      return !(value && key.toLowerCase() === 'level');
    });
  if (!level) return rest.join(' ');
  return ['level:' + level.toUpperCase(), ...rest].join(' ');
}
