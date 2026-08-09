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
 *   end-of-stream marker) is intentionally *not* part of `LogRecordLike` and
 *   gets no bypass here. These markers carry a real level and a real tag
 *   (`W`/`xenon`, `E`/`xenon`), so they already interact with the query
 *   grammar exactly like device output would: a `level:E` filter still shows
 *   "log stream ended" but hides "N lines dropped", a `tag:` or bare-text
 *   filter can hide either. Silently exempting them from a query the user
 *   typed would break "all terms ANDed" for a subset of rows with no way to
 *   turn it off. If a caller wants data-loss markers to always be visible
 *   regardless of the active filter, that's a rendering decision (e.g. a
 *   banner outside the filtered list), not a change to this predicate.
 */
export const LEVEL_ORDER = ['V', 'D', 'I', 'W', 'E', 'F'] as const;

export interface LogRecordLike {
  level: string;
  tag: string;
  message: string;
  pkg?: string;
}

export interface LogcatQuery {
  minLevel?: string;
  tag?: string;
  pkg?: string;
  text?: string;
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
 */
export function parseQuery(raw: string): LogcatQuery {
  const q: LogcatQuery = {};
  const words: string[] = [];
  for (const token of raw.trim().split(/\s+/).filter(Boolean)) {
    const [key, ...rest] = token.split(':');
    const value = rest.join(':');
    if (value && key.toLowerCase() === 'level') q.minLevel = value.toUpperCase();
    else if (value && key.toLowerCase() === 'tag') q.tag = value.toLowerCase();
    else if (value && key.toLowerCase() === 'package') q.pkg = value.toLowerCase();
    else words.push(token);
  }
  if (words.length) q.text = words.join(' ').toLowerCase();
  return q;
}

export function matches(r: LogRecordLike, q: LogcatQuery): boolean {
  if (q.minLevel) {
    const want = LEVEL_ORDER.indexOf(q.minLevel as (typeof LEVEL_ORDER)[number]);
    const have = LEVEL_ORDER.indexOf(r.level as (typeof LEVEL_ORDER)[number]);
    // An unrecognized minLevel or record level (index -1) never filters
    // anything out, rather than throwing or matching nothing.
    if (want >= 0 && have >= 0 && have < want) return false;
  }
  if (q.tag && !r.tag.toLowerCase().includes(q.tag)) return false;
  if (q.pkg && !(r.pkg ?? '').toLowerCase().includes(q.pkg)) return false;
  if (q.text && !r.message.toLowerCase().includes(q.text)) return false;
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
      const [key] = token.split(':');
      return key.toLowerCase() !== 'level';
    });
  if (!level) return rest.join(' ');
  return ['level:' + level.toUpperCase(), ...rest].join(' ');
}
