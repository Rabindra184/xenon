import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { countAccentUses, isExempt } from './accent-uses';

const WEB = path.resolve(__dirname, '../..');
const BASELINE = path.join(__dirname, 'accent-uses.baseline.json');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.(tsx?|css)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Ratchet on the accent green outside the shared components. Green means
 * "act here", "selected", "focused" or "you are here" (the rule beside
 * --color-accent in src/tokens.css); decoration and data are neutral. A file
 * may lose accent uses but never gain one: a new control takes its green
 * from the shared Button, SegmentedControl, Input or Select.
 *
 * After removing uses, rewrite the baseline:
 *   UPDATE_ACCENT_BASELINE=1 npx vitest run src/design/accent-uses.test.ts
 */
describe('accent green outside the shared components', () => {
  const counts: Record<string, number> = {};
  for (const f of sourceFiles(path.join(WEB, 'src'))) {
    const rel = path.relative(WEB, f).split(path.sep).join('/');
    if (isExempt(rel)) continue;
    const n = countAccentUses(fs.readFileSync(f, 'utf8'));
    if (n) counts[rel] = n;
  }
  const baseline: Record<string, number> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

  if (process.env.UPDATE_ACCENT_BASELINE) {
    const sorted = Object.fromEntries(
      Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
    );
    fs.writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + '\n');
  }

  it('no file uses the accent more than its recorded baseline', () => {
    const grew = Object.entries(counts)
      .filter(([f, n]) => n > (baseline[f] ?? 0))
      .map(
        ([f, n]) =>
          `${f}: ${n} (baseline ${baseline[f] ?? 0}) — green is for actions, selection and focus; use a shared control, or --text / --text-muted for decoration and data`,
      );
    expect(grew).toEqual([]);
  });

  it('the baseline has no stale headroom (lower it when you remove uses)', () => {
    const stale = Object.entries(baseline)
      .filter(([f, n]) => (counts[f] ?? 0) < n)
      .map(([f, n]) => `${f}: now ${counts[f] ?? 0}, baseline says ${n}`);
    expect(stale).toEqual([]);
  });

  it('counts each way the accent is written, and ignores comments', () => {
    expect(
      countAccentUses('.a { color: var(--color-accent); border-color: var(--color-accent-soft) }'),
    ).toBe(2);
    expect(countAccentUses('.a { background: rgb(var(--rgb-accent) / 0.1) }')).toBe(1);
    expect(
      countAccentUses('<i className="text-[var(--color-accent)] bg-[var(--accent-subtle)]" />'),
    ).toBe(2);
    expect(countAccentUses("style={{ color: 'var(--color-accent)' }}")).toBe(1);
    expect(countAccentUses('.a { color: var(--color-success); color: var(--text-muted) }')).toBe(0);
    expect(countAccentUses('/* was var(--color-accent) */')).toBe(0);
  });

  it('exempts the shared components and the tokens', () => {
    expect(isExempt('src/components/ui/button.css')).toBe(true);
    expect(isExempt('src/tokens.css')).toBe(true);
    expect(isExempt('src/components/apps/apps.css')).toBe(false);
  });
});
