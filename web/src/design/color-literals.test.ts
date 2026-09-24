import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { EXEMPT, countColorLiterals } from './color-literals';
import baseline from './color-literals.baseline.json';

const WEB = path.resolve(__dirname, '../..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.(tsx?|css)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Ratchet on hard-coded colours. Stage 0 moved ~500 literals into tokens
 * (src/tokens.css); what's left is recorded in the baseline. A file may lose
 * literals (then lower its number in the baseline) but never gain one: new
 * styling must use a token, or the theme work can't reach it.
 */
describe('hard-coded colours', () => {
  const counts: Record<string, number> = {};
  for (const f of sourceFiles(path.join(WEB, 'src'))) {
    const rel = path.relative(WEB, f).split(path.sep).join('/');
    if (EXEMPT[rel]) continue;
    const n = countColorLiterals(fs.readFileSync(f, 'utf8'));
    if (n) counts[rel] = n;
  }

  it('no file has more raw colours than its recorded baseline', () => {
    const grew = Object.entries(counts)
      .filter(([f, n]) => n > ((baseline as Record<string, number>)[f] ?? 0))
      .map(
        ([f, n]) =>
          `${f}: ${n} (baseline ${(baseline as Record<string, number>)[f] ?? 0}) — use a token from src/tokens.css`,
      );
    expect(grew).toEqual([]);
  });

  it('the baseline has no stale headroom (lower it when you remove literals)', () => {
    const stale = Object.entries(baseline as Record<string, number>)
      .filter(([f, n]) => (counts[f] ?? 0) < n)
      .map(([f, n]) => `${f}: now ${counts[f] ?? 0}, baseline says ${n}`);
    expect(stale).toEqual([]);
  });
});
