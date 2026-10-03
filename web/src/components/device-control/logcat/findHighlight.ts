/**
 * Splits text around its Find matches, so a row can mark each one.
 *
 * A regular expression with the needle escaped, rather than comparing
 * lowercased copies: lowercasing can change a string's length (`İ` becomes
 * two code units), which would put the marks in the wrong place.
 */
export interface TextPart {
  text: string;
  hit: boolean;
}

const SPECIAL = /[.*+?^${}()|[\]\\]/g;

export function splitMatches(text: string, needle: string, caseSensitive: boolean): TextPart[] {
  if (!needle || !text) return [{ text, hit: false }];
  const re = new RegExp(needle.replace(SPECIAL, '\\$&'), caseSensitive ? 'g' : 'gi');
  const parts: TextPart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), hit: false });
    parts.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
  }
  if (!parts.length) return [{ text, hit: false }];
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return parts;
}
