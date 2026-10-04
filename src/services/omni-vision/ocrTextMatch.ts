/**
 * Finding a text, one word or several, among the words OCR read off a
 * screenshot. Tesseract gives one box per word, so a text with a space in it
 * ("Sign in") is looked for across neighbouring words on one line, and its
 * box is the box around the words it covers.
 *
 * Pure: boxes in, boxes out, in the screenshot's pixels.
 */

/** One OCR word and its box (OmniVisionService.normalizeWordBBox). Confidence is 0-100. */
export interface OcrWordBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  text: string;
  confidence: number;
}

/**
 * Two words further apart than this many times their height are not
 * neighbours: a space is about a third of a word's height, and a gap this
 * wide is another column, such as "Cancel" and "Done" at either end of a bar.
 */
const MAX_GAP_IN_HEIGHTS = 1.5;

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
const heightOf = (w: { y0: number; y1: number }) => Math.max(1, w.y1 - w.y0);

/** Whether a word sits on a line: their heights overlap by at least half the shorter one. */
function onLine(line: { y0: number; y1: number }, word: OcrWordBox): boolean {
  const overlap = Math.min(line.y1, word.y1) - Math.max(line.y0, word.y0);
  return overlap > 0 && overlap >= Math.min(heightOf(line), heightOf(word)) / 2;
}

/**
 * The words in runs of neighbours: on one line, left to right, with no wide
 * gap between them. Runs are in reading order.
 */
export function wordRuns(words: OcrWordBox[]): OcrWordBox[][] {
  const lines: Array<{ y0: number; y1: number; words: OcrWordBox[] }> = [];
  for (const word of [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const line = lines.find((l) => onLine(l, word));
    if (line) {
      line.words.push(word);
      line.y0 = Math.min(line.y0, word.y0);
      line.y1 = Math.max(line.y1, word.y1);
    } else {
      lines.push({ y0: word.y0, y1: word.y1, words: [word] });
    }
  }

  const runs: OcrWordBox[][] = [];
  for (const line of lines.sort((a, b) => a.y0 - b.y0)) {
    let run: OcrWordBox[] = [];
    for (const word of line.words.sort((a, b) => a.x0 - b.x0)) {
      const previous = run[run.length - 1];
      const gap = previous ? word.x0 - previous.x1 : 0;
      if (previous && gap > MAX_GAP_IN_HEIGHTS * Math.max(heightOf(previous), heightOf(word))) {
        runs.push(run);
        run = [];
      }
      run.push(word);
    }
    if (run.length) runs.push(run);
  }
  return runs;
}

/**
 * Every place `text` appears, ignoring case and runs of spaces, within a word
 * or across neighbouring words: "Sign in" in "Sign" "in", "password" in
 * "password?". Each match covers the words it touches: its box surrounds
 * them, its text is theirs joined with spaces, and its confidence is the
 * lowest of theirs. A one-word text matches inside one word, as it always
 * did. Matches are in reading order.
 */
export function findText(words: OcrWordBox[], text: string): OcrWordBox[] {
  const wanted = normalize(text);
  if (!wanted) return [];

  const matches: OcrWordBox[] = [];
  for (const run of wordRuns(words)) {
    // The run as one string, remembering where each word sits in it.
    let line = '';
    const spans: Array<{ start: number; end: number }> = [];
    for (const word of run) {
      if (line) line += ' ';
      const start = line.length;
      line += normalize(word.text);
      spans.push({ start, end: line.length });
    }

    const seen = new Set<string>();
    for (let at = line.indexOf(wanted); at !== -1; at = line.indexOf(wanted, at + 1)) {
      const end = at + wanted.length;
      const first = spans.findIndex((s) => s.end > at);
      const last = spans.findIndex((s) => s.end >= end);
      const key = `${first}-${last}`;
      if (first === -1 || last === -1 || seen.has(key)) continue;
      seen.add(key);
      const covered = run.slice(first, last + 1);
      matches.push({
        x0: Math.min(...covered.map((w) => w.x0)),
        y0: Math.min(...covered.map((w) => w.y0)),
        x1: Math.max(...covered.map((w) => w.x1)),
        y1: Math.max(...covered.map((w) => w.y1)),
        text: covered.map((w) => w.text).join(' '),
        confidence: Math.min(...covered.map((w) => w.confidence)),
      });
    }
  }
  return matches;
}
