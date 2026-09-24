/**
 * Display names for values that used to be upper-cased for the UI
 * ("ANDROID 10", "RUNNING"). Labels are sentence case; brand casing wins.
 */
const PLATFORM: Record<string, string> = {
  android: 'Android',
  androidtv: 'Android TV',
  'android-tv': 'Android TV',
  ios: 'iOS',
  tvos: 'tvOS',
  ipados: 'iPadOS',
};

export function platformLabel(p?: string | null): string {
  if (!p) return '';
  const key = p.trim().toLowerCase();
  return PLATFORM[key] ?? sentenceCase(key);
}

/** "running" / "RUNNING" / "not_started" → "Running" / "Not started". */
export function sentenceCase(s?: string | null): string {
  const t = (s ?? '').trim().replace(/[_-]+/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
