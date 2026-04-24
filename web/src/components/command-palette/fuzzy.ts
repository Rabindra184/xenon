/**
 * Fuzzy score query against target. 0 means no match; higher is better.
 *
 * Heuristics:
 *  - Exact match: big bonus (10_000).
 *  - Prefix match: large bonus, minus remaining length so shorter beats longer.
 *  - Subsequence: requires every query char to appear in order; each match
 *    contributes a base + bonus for contiguous streaks, and is penalised for
 *    gaps between consecutive matches.
 *  - Case-insensitive.
 */
export function fuzzyScore(query: string, target: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t === q) return 10_000;
  if (t.startsWith(q)) return 5_000 - (t.length - q.length);

  let ti = 0;
  let score = 0;
  let streak = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    const nextIdx = t.indexOf(c, ti);
    if (nextIdx === -1) return 0;
    if (nextIdx === ti) {
      streak += 1;
      score += 20 + streak * 5;
    } else {
      streak = 0;
      score += 10 - Math.min(nextIdx - ti, 10);
    }
    ti = nextIdx + 1;
  }
  return Math.max(score, 1);
}
