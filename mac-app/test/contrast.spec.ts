import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain-JS build script lib, no types needed for these assertions.
import { contrastRatio, parseThemeBlocks, resolveVar } from '../scripts/tokens-lib.mjs';

// Pins the WCAG contrast of the colour pairs the screens are built from, in both
// themes. It reads the generated tokens.css, which is what the app ships, so a
// palette change that breaks a pair fails here before it reaches a screen.

type Vars = Record<string, string>;
interface Pair {
  fg: string;
  bg: string;
  min: number;
}

const css = readFileSync(resolve(__dirname, '../src/renderer/src/tokens.css'), 'utf8');
const { dark, light } = parseThemeBlocks(css) as { dark: Vars; light: Vars };
/** Light only restates what differs, so it resolves against dark with light on top. */
const THEMES: Record<string, Vars> = { dark, light: { ...dark, ...light } };

const SURFACES = ['--bg', '--surface', '--surface-2'];
const ACCENTS = ['--color-accent', '--color-danger', '--color-warning', '--color-info', '--color-success'];

const PAIRS: Pair[] = [
  // Text, at 4.5:1.
  ...['--text', '--text-muted', '--text-dim'].flatMap((fg) => SURFACES.map((bg) => ({ fg, bg, min: 4.5 }))),
  { fg: '--color-on-accent', bg: '--color-accent', min: 4.5 },
  // Accent and status colours used as text or icons, at 4.5:1.
  ...ACCENTS.flatMap((fg) => ['--bg', '--surface'].map((bg) => ({ fg, bg, min: 4.5 }))),
  // Control boundaries and the focus ring, at 3:1.
  ...['--text-dim', '--color-focus-ring'].flatMap((fg) => ['--bg', '--surface'].map((bg) => ({ fg, bg, min: 3 })))
];

/** The pairs that fall below their minimum, as readable lines. */
function failures(vars: Vars, pairs: Pair[] = PAIRS): string[] {
  return pairs.flatMap(({ fg, bg, min }) => {
    const ratio = contrastRatio(resolveVar(fg, vars), resolveVar(bg, vars)) as number;
    return ratio >= min ? [] : [`${fg} on ${bg}: ${ratio.toFixed(2)}, needs ${min}`];
  });
}

describe('token contrast', () => {
  for (const [theme, vars] of Object.entries(THEMES)) {
    it(`every text, accent and control pair passes in the ${theme} theme`, () => {
      expect(failures(vars)).toEqual([]);
    });
  }

  it('reports a pair that falls below its minimum', () => {
    const faded = { ...THEMES.dark, '--text-dim': '#2a2f38' };
    const found = failures(faded);
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((line) => line.startsWith('--text-dim on --bg:'))).toBe(true);
  });
});
