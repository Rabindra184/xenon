import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { EXEMPT, countFontSizeLiterals } from './font-size-literals';

const WEB = path.resolve(__dirname, '../..');
const BASELINE = path.join(__dirname, 'font-size-literals.baseline.json');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.(tsx?|css)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Ratchet on hard-coded font sizes. Text takes its size from a type role in
 * src/tokens.css (--type-caption-size … --type-display-size, or Tailwind's
 * text-caption … text-display). What hasn't moved yet is recorded in the
 * baseline: a file may lose raw sizes but never gain one.
 *
 * After moving sizes to roles, rewrite the baseline:
 *   UPDATE_FONT_SIZE_BASELINE=1 npx vitest run src/design/font-size-literals.test.ts
 */
describe('hard-coded font sizes', () => {
  const counts: Record<string, number> = {};
  for (const f of sourceFiles(path.join(WEB, 'src'))) {
    const rel = path.relative(WEB, f).split(path.sep).join('/');
    if (EXEMPT[rel]) continue;
    const n = countFontSizeLiterals(fs.readFileSync(f, 'utf8'));
    if (n) counts[rel] = n;
  }
  const baseline: Record<string, number> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

  if (process.env.UPDATE_FONT_SIZE_BASELINE) {
    const sorted = Object.fromEntries(
      Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
    );
    fs.writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + '\n');
  }

  it('no file has more raw font sizes than its recorded baseline', () => {
    const grew = Object.entries(counts)
      .filter(([f, n]) => n > (baseline[f] ?? 0))
      .map(
        ([f, n]) =>
          `${f}: ${n} (baseline ${baseline[f] ?? 0}) — use a type role from src/tokens.css (text-caption … text-display)`,
      );
    expect(grew).toEqual([]);
  });

  it('the baseline has no stale headroom (lower it when you remove raw sizes)', () => {
    const stale = Object.entries(baseline)
      .filter(([f, n]) => (counts[f] ?? 0) < n)
      .map(([f, n]) => `${f}: now ${counts[f] ?? 0}, baseline says ${n}`);
    expect(stale).toEqual([]);
  });

  it('counts each way a size is written, and ignores roles and comments', () => {
    expect(countFontSizeLiterals('.a { font-size: 11px; } .b { font-size: 0.8rem }')).toBe(2);
    expect(countFontSizeLiterals('<p className="text-[11px] text-caption" />')).toBe(1);
    expect(countFontSizeLiterals("style={{ fontSize: '11px' }} style={{ fontSize: 12 }}")).toBe(2);
    expect(
      countFontSizeLiterals('.a { font-size: var(--type-label-size); font-size: inherit; }'),
    ).toBe(0);
    expect(countFontSizeLiterals("style={{ fontSize: 'var(--type-mono-size)' }}")).toBe(0);
    expect(countFontSizeLiterals('/* was font-size: 11px */ // text-[10px]')).toBe(0);
  });
});
