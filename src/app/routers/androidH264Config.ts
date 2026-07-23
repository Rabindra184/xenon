export type H264Source = 'scrcpy' | 'screenrecord';
export type AndroidH264Config = boolean | { source?: H264Source };

/**
 * Normalize the accepted flag shapes to one `{ enabled, source }`. Config values
 * are untrusted and can arrive as a real boolean, a STRINGIFIED boolean
 * (`"true"` / `"false"` — some Appium config sources and the Xenon Control form
 * serialize booleans as strings), or a `{ source }` object:
 *
 *   false | "false" | undefined | ""  → disabled (pure MJPEG)
 *   true  | "true"                     → enabled, scrcpy (default source)
 *   { source }                         → enabled, that source (scrcpy default)
 *   any other truthy scalar            → enabled, scrcpy
 *
 * The string handling matters: without it a stringified `"false"` is truthy and
 * would wrongly ENABLE the feature, so the flag could never be turned off from a
 * source that stringifies booleans.
 */
export function resolveAndroidH264(cfg: unknown): { enabled: boolean; source: H264Source } {
  if (!cfg || cfg === 'false') return { enabled: false, source: 'scrcpy' };
  if (cfg === true || cfg === 'true') return { enabled: true, source: 'scrcpy' };
  if (typeof cfg === 'object') {
    const source = (cfg as { source?: unknown }).source;
    return { enabled: true, source: source === 'screenrecord' ? 'screenrecord' : 'scrcpy' };
  }
  return { enabled: true, source: 'scrcpy' };
}
