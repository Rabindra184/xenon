import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { EXEMPT, countSurfaceLiterals } from './surface-literals';

const WEB = path.resolve(__dirname, '../..');
const BASELINE = path.join(__dirname, 'surface-literals.baseline.json');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.(tsx?|css)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Ratchet on surfaces drawn with numbers. Shadows, rings and corners come
 * from src/tokens.css (--elevation-*, --ring-*, --focus-outline,
 * --radius-*); glass blur belongs only behind a modal. What hasn't moved yet
 * is recorded in the baseline: a file may lose raw values but never gain one.
 *
 * After moving values to tokens, rewrite the baseline:
 *   UPDATE_SURFACE_BASELINE=1 npx vitest run src/design/surface-literals.test.ts
 */
describe('surfaces drawn with numbers', () => {
  const counts: Record<string, number> = {};
  for (const f of sourceFiles(path.join(WEB, 'src'))) {
    const rel = path.relative(WEB, f).split(path.sep).join('/');
    if (EXEMPT[rel] || rel.startsWith('src/design/')) continue;
    const n = countSurfaceLiterals(fs.readFileSync(f, 'utf8'));
    if (n) counts[rel] = n;
  }
  const baseline: Record<string, number> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

  if (process.env.UPDATE_SURFACE_BASELINE) {
    const sorted = Object.fromEntries(
      Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
    );
    fs.writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + '\n');
  }

  it('no file draws more raw shadows, radii or blurs than its recorded baseline', () => {
    const grew = Object.entries(counts)
      .filter(([f, n]) => n > (baseline[f] ?? 0))
      .map(
        ([f, n]) =>
          `${f}: ${n} (baseline ${baseline[f] ?? 0}) — use --elevation-*, --ring-*, --focus-outline or --radius-* from src/tokens.css`,
      );
    expect(grew).toEqual([]);
  });

  it('the baseline has no stale headroom (lower it when you move values to tokens)', () => {
    const stale = Object.entries(baseline)
      .filter(([f, n]) => (counts[f] ?? 0) < n)
      .map(([f, n]) => `${f}: now ${counts[f] ?? 0}, baseline says ${n}`);
    expect(stale).toEqual([]);
  });

  it('counts raw shadows, radii and blurs, and ignores tokens', () => {
    expect(countSurfaceLiterals('.a { box-shadow: 0 4px 12px rgb(0 0 0 / 0.3); }')).toBe(1);
    expect(countSurfaceLiterals('.a { box-shadow:\n  0 1px 2px red,\n  0 2px 4px red; }')).toBe(1);
    expect(countSurfaceLiterals('.a { border-radius: 6px; border-top-left-radius: 4px }')).toBe(2);
    expect(countSurfaceLiterals('.a { backdrop-filter: blur(16px); }')).toBe(1);
    expect(
      countSurfaceLiterals(
        '.a { box-shadow: none; box-shadow: var(--elevation-modal); border-radius: 50%; border-radius: 0; border-radius: var(--radius-md) var(--radius-md) 0 0; border-radius: calc(var(--radius-md) - 2px); box-shadow: var(--ring-field), var(--elevation-raised); }',
      ),
    ).toBe(0);
    expect(countSurfaceLiterals('<div className="rounded-md shadow-overlay rounded-full" />')).toBe(0);
    expect(
      countSurfaceLiterals('<div className="shadow-lg rounded-[10px] shadow-[0_0_4px_red] backdrop-blur-sm" />'),
    ).toBe(4);
    expect(countSurfaceLiterals("style={{ boxShadow: '0 0 4px red', borderRadius: 8 }}")).toBe(2);
    expect(
      countSurfaceLiterals("style={{ boxShadow: 'var(--elevation-flat)', borderRadius: '50%' }}"),
    ).toBe(0);
    expect(countSurfaceLiterals('/* was box-shadow: 0 0 4px red */')).toBe(0);
    expect(countSurfaceLiterals('.a { box-shadow: var(--shadow-lg); }')).toBe(0);
  });
});
