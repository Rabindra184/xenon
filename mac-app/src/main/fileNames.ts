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
