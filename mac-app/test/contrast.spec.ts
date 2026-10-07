import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain-JS build script lib, no types needed for these assertions.
import { blend, contrastRatio, parseThemeBlocks, resolveVar } from '../scripts/tokens-lib.mjs';

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
  // The danger button's label (text-danger-fg is the on-accent colour). White
  // on the danger red is only 3.8:1 in dark, so the label follows the theme.
  { fg: '--color-on-accent', bg: '--color-danger', min: 4.5 },
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

/**
 * Text on a status tint (a Banner, a Badge, a `bg-warn/10` notice) is `--text`;
 * the status colour goes on the border and the icon. In light, the status
 * colours on their own 10% tint fall to about 4.1:1 (warning) and 4.5:1 (danger),
 * so this pins the rule the screens follow instead: ordinary text on each
 * tint, laid over each surface it can sit on, at 4.5:1.
 */
const TINT_ALPHA = 0.1;

function tintFailures(vars: Vars, text = '--text'): string[] {
  return ACCENTS.flatMap((status) =>
    SURFACES.flatMap((surface) => {
      const tint = blend(resolveVar(status, vars), resolveVar(surface, vars), TINT_ALPHA) as string;
      const ratio = contrastRatio(resolveVar(text, vars), tint) as number;
      return ratio >= 4.5 ? [] : [`${text} on ${status} at ${TINT_ALPHA * 100}% over ${surface}: ${ratio.toFixed(2)}, needs 4.5`];
    })
  );
}

describe('token contrast', () => {
  for (const [theme, vars] of Object.entries(THEMES)) {
    it(`every text, accent and control pair passes in the ${theme} theme`, () => {
      expect(failures(vars)).toEqual([]);
    });
  }

  for (const [theme, vars] of Object.entries(THEMES)) {
    it(`ordinary text on every status tint passes in the ${theme} theme`, () => {
      expect(tintFailures(vars)).toEqual([]);
    });
  }

  it('reports text on a tint that falls below 4.5:1', () => {
    // A mid grey reads on the plain page in neither theme's tints.
    const found = tintFailures({ ...THEMES.light, '--text': '#8a8f98' });
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((line) => line.startsWith('--text on --color-warning at 10% over --bg:'))).toBe(true);
  });

  it('reports a pair that falls below its minimum', () => {
    const faded = { ...THEMES.dark, '--text-dim': '#2a2f38' };
    const found = failures(faded);
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((line) => line.startsWith('--text-dim on --bg:'))).toBe(true);
  });
});
