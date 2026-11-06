// Shared by the guard test (wording.test.ts), which also rewrites the baseline.

/**
 * Words the dashboard shouldn't say to a tester (CLAUDE.md, "plain UI copy"):
 * marketing that names nothing ("global registry", "orchestration", "fleet",
 * "device farm", "infrastructure") and internal names ("etalon").
 */
export const JARGON =
  /\b(?:global (?:device )?registry|global pool|infrastructure|orchestrat\w*|fleets?|device farms?|etalon)\b/gi;

/** Two or more all-capital words in a row: shouting, not a label. "OK", "API", "iOS" alone pass. */
export const SHOUTING = /\b[A-Z]{3,}(?:[ &]+[A-Z]{2,})+\b/g;

/**
 * The text a page shows: JSX text between tags and string literals. Comments,
 * imports, class names and CSS are left out, as are identifiers and API values.
 */
export function shownText(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const out: string[] = [];
  for (const m of Array.from(code.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g))) out.push(m[1]);
  for (const m of Array.from(code.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g))) {
    const line = code.slice(code.lastIndexOf('\n', m.index) + 1, m.index);
    if (/\b(?:import|from|className|class|require)\b/.test(line)) continue;
    if (/^[\w./:-]*$/.test(m[2])) continue; // an id, key, path or class, not a sentence
    out.push(m[2]);
  }
  return out;
}

export function countWording(source: string): number {
  let n = 0;
  for (const t of shownText(source)) {
    n += (t.match(JARGON) ?? []).length;
    n += (t.match(SHOUTING) ?? []).length;
  }
  return n;
}
