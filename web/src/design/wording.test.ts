import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { countWording } from './wording';

const WEB = path.resolve(__dirname, '../..');
const BASELINE = path.join(__dirname, 'wording.baseline.json');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Ratchet on dashboard wording. The dashboard is for testers: say what a
 * thing does, in plain words, without marketing ("global registry",
 * "orchestration", "fleet") or internal names ("etalon"), and without
 * ALL-CAPS sentences. A file may lose such phrases but never gain one.
 *
 * After rewording, rewrite the baseline:
 *   UPDATE_WORDING_BASELINE=1 npx vitest run src/design/wording.test.ts
 */
describe('dashboard wording', () => {
  const counts: Record<string, number> = {};
  for (const f of sourceFiles(path.join(WEB, 'src'))) {
    const rel = path.relative(WEB, f).split(path.sep).join('/');
    const n = countWording(fs.readFileSync(f, 'utf8'));
    if (n) counts[rel] = n;
  }
  const baseline: Record<string, number> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

  if (process.env.UPDATE_WORDING_BASELINE) {
    const sorted = Object.fromEntries(
      Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
    );
    fs.writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + '\n');
  }

  it('no file has more jargon or shouting than its recorded baseline', () => {
    const grew = Object.entries(counts)
      .filter(([f, n]) => n > (baseline[f] ?? 0))
      .map(
        ([f, n]) =>
          `${f}: ${n} (baseline ${baseline[f] ?? 0}) — say what it does in plain words, in sentence case`,
      );
    expect(grew).toEqual([]);
  });

  it('the baseline has no stale headroom (lower it when you reword)', () => {
    const stale = Object.entries(baseline)
      .filter(([f, n]) => (counts[f] ?? 0) < n)
      .map(([f, n]) => `${f}: now ${counts[f] ?? 0}, baseline says ${n}`);
    expect(stale).toEqual([]);
  });

  it('finds jargon and shouting in what a page shows, not in code', () => {
    expect(countWording('<p>Syncing the global device registry.</p>')).toBe(1);
    expect(countWording("toast('Parameters synchronized across fleet.')")).toBe(1);
    expect(countWording('<p>SYNCING REGISTRY...</p>')).toBe(1);
    expect(countWording('<p>VERIFYING CHECKSUM & DEPLOYING</p>')).toBe(1);
    expect(countWording('<p>separating CI runners and staging fleets</p>')).toBe(1);
    expect(countWording('<p>No devices yet</p>')).toBe(0);
    expect(countWording('<span>API keys</span> <b>OK</b>')).toBe(0);
    expect(countWording("import { Fleet } from './fleet-status';")).toBe(0);
    expect(countWording("const role = 'SUPER_ADMIN';")).toBe(0);
    expect(countWording('// the global registry used to be here')).toBe(0);
  });
});
