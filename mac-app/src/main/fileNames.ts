/**
 * A profile's name as the start of a file name: letters, digits, dashes and
 * underscores, the rest joined into one underscore, at most `max` characters.
 * An imported profile can hold anything where the name goes, so a name that is
 * not text, or comes out empty, gives `fallback`.
 */
export function fileStem(name: unknown, fallback: string, max = Infinity): string {
  const stem = typeof name === 'string' ? name.replace(/[^a-z0-9-_]+/gi, '_').slice(0, max) : '';
  return stem || fallback;
}

/** The name a saved log starts with: xenon-log-YYYY-MM-DD-HHMM.txt, in the Mac's local time. */
export function logFileName(now: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  return `xenon-log-${day}-${two(now.getHours())}${two(now.getMinutes())}.txt`;
}
