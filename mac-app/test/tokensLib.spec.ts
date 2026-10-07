import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain-JS build script lib, no types needed for these assertions.
import { COLOR_VARS, MissingTokenError, contrastRatio, generateTokensCss, hexToRgbChannels, parseThemeBlocks, resolveVar } from '../scripts/tokens-lib.mjs';

/** One declaration per colour the launcher consumes, so a fixture passes the missing-token check. */
const requiredDecls = (omit?: string): string =>
  (COLOR_VARS as string[])
    .filter((name) => name !== omit)
    .map((name) => `  ${name}: ${name === '--bg' ? '#0e1013' : '#123456'};`)
    .join('\n');

const FIXTURE = `
/* Dark islands — a comment with braces { } and :root in it. */
.theme-dark,
:root {
  color-scheme: dark;
${requiredDecls()}
  --space-1: 4px;
}

.theme-dark,
:root {
  --black: #000000;
  --font-size-md: 14px;
}

:root[data-theme='light'] {
  color-scheme: light;
  --bg: #f6f7f9;
}

:where(:root[data-theme='light'] .theme-dark) {
  --from-where: 1;
  color: var(--text);
}

.scanline { --from-legacy: 1; }

@media (prefers-reduced-motion: reduce) {
  * { --from-media: 1; }
}
`;

describe('parseThemeBlocks', () => {
  const { dark, light } = parseThemeBlocks(FIXTURE);

  it('merges every :root block into dark, in order', () => {
    expect(dark['--bg']).toBe('#0e1013');
    expect(dark['--space-1']).toBe('4px');
    // Declared only in the second `.theme-dark, :root` block.
    expect(dark['--font-size-md']).toBe('14px');
    expect(dark['--black']).toBe('#000000');
  });

  it('reads the light block on its own, with a different --bg', () => {
    expect(light).toEqual({ '--bg': '#f6f7f9' });
    expect(light['--bg']).not.toBe(dark['--bg']);
  });

  it('ignores :where(), @media and every other selector', () => {
    for (const theme of [dark, light]) {
      expect(theme).not.toHaveProperty('--from-where');
      expect(theme).not.toHaveProperty('--from-legacy');
      expect(theme).not.toHaveProperty('--from-media');
    }
  });

  it('returns an empty light theme when the file has none', () => {
    expect(parseThemeBlocks(`:root {\n${requiredDecls()}\n}`).light).toEqual({});
  });

  it('throws a named error when the dashboard drops a token we consume', () => {
    const css = `:root {\n${requiredDecls('--bg')}\n}`;
    expect(() => parseThemeBlocks(css)).toThrow(MissingTokenError);
    expect(() => parseThemeBlocks(css)).toThrow(/--bg/);
  });
});

describe('resolveVar', () => {
  it('returns a literal value as is', () => {
    expect(resolveVar('--a', { '--a': '#22c55e' })).toBe('#22c55e');
  });

  it('follows var() chains', () => {
    const vars = { '--a': 'var(--b)', '--b': 'var(--c)', '--c': '#000000' };
    expect(resolveVar('--a', vars)).toBe('#000000');
  });

  it('leaves compound values alone', () => {
    const vars = { '--a': 'rgb(var(--rgb-x) / 0.1)', '--rgb-x': '1 2 3' };
    expect(resolveVar('--a', vars)).toBe('rgb(var(--rgb-x) / 0.1)');
  });

  it('gives up on a reference cycle', () => {
    expect(() => resolveVar('--a', { '--a': 'var(--b)', '--b': 'var(--a)' })).toThrow(/--a/);
  });

  it('names a variable that is not defined', () => {
    expect(() => resolveVar('--a', { '--a': 'var(--gone)' })).toThrow(MissingTokenError);
    expect(() => resolveVar('--a', { '--a': 'var(--gone)' })).toThrow(/--gone/);
  });
});

describe('hexToRgbChannels', () => {
  it('converts 6-digit hex to space-separated channels', () => {
    expect(hexToRgbChannels('#22c55e')).toBe('34 197 94');
    expect(hexToRgbChannels('#0a0d0c')).toBe('10 13 12');
  });

  it('expands 3-digit shorthand', () => {
    expect(hexToRgbChannels('#fff')).toBe('255 255 255');
  });

  it('returns null for non-hex values', () => {
    expect(hexToRgbChannels('rgba(1, 2, 3, 0.5)')).toBeNull();
    expect(hexToRgbChannels('4px')).toBeNull();
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white, whichever way round', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 2);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2);
  });

  it('is 1 for a colour on itself', () => {
    expect(contrastRatio('#22c55e', '#22c55e')).toBeCloseTo(1, 2);
  });
});

describe('generateTokensCss', () => {
  /** The text of one rule, from its selector to its closing brace. */
  const rule = (css: string, selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    expect(start, `${selector} rule`).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('\n}', start));
  };
  const LIGHT = ":root[data-theme='light']";

  it('marks the file as generated so nobody hand-edits it', () => {
    const css = generateTokensCss({ dark: { '--bg': '#000000' }, light: {} });
    expect(css).toMatch(/generated/i);
    expect(css).toMatch(/sync:tokens/);
  });

  it('writes a dark :root rule and a light rule, each with its colour-scheme', () => {
    const css = generateTokensCss({ dark: { '--bg': '#0e1013' }, light: { '--bg': '#f6f7f9' } });
    expect(rule(css, ':root')).toContain('color-scheme: dark;');
    expect(rule(css, ':root')).toContain('--bg: #0e1013;');
    expect(rule(css, LIGHT)).toContain('color-scheme: light;');
    expect(rule(css, LIGHT)).toContain('--bg: #f6f7f9;');
  });

  it('puts the dark rule first so the light one wins', () => {
    const css = generateTokensCss({ dark: { '--bg': '#000000' }, light: { '--bg': '#ffffff' } });
    expect(css.indexOf(':root {')).toBeLessThan(css.indexOf(`${LIGHT} {`));
  });

  it('copies non-colour values verbatim and gives them no channels', () => {
    const css = generateTokensCss({
      dark: {
        '--space-4': '16px',
        '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.25)',
        '--status-ready-bg': 'rgb(var(--rgb-success) / 0.1)'
      },
      light: {}
    });
    expect(css).toContain('--space-4: 16px;');
    expect(css).toContain('--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.25);');
    expect(css).toContain('--status-ready-bg: rgb(var(--rgb-success) / 0.1);');
    expect(css).not.toMatch(/--(space-4|shadow-sm|status-ready-bg)-rgb/);
  });

  it('gives each hex colour an -rgb channel triple', () => {
    const css = generateTokensCss({ dark: { '--bg': '#0a0d0c' }, light: {} });
    expect(rule(css, ':root')).toContain('--bg-rgb: 10 13 12;');
  });

  it('resolves channels through var()', () => {
    const css = generateTokensCss({
      dark: { '--black': '#000000', '--color-on-accent': 'var(--black)' },
      light: {}
    });
    expect(css).toContain('--color-on-accent: var(--black);');
    expect(css).toContain('--color-on-accent-rgb: 0 0 0;');
  });

  it('recomputes light channels when only a primitive is overridden', () => {
    const css = generateTokensCss({
      dark: { '--green': '#22c55e', '--color-accent': 'var(--green)' },
      light: { '--green': '#15803d' }
    });
    expect(rule(css, ':root')).toContain('--color-accent-rgb: 34 197 94;');
    const light = rule(css, LIGHT);
    expect(light).toContain('--green-rgb: 21 128 61;');
    expect(light).toContain('--color-accent-rgb: 21 128 61;');
    // It restates the channels, not the variable it never overrode.
    expect(light).not.toContain('--color-accent: ');
  });
});

describe("the dashboard's real tokens.css", () => {
  const source = readFileSync(resolve(__dirname, '../../web/src/tokens.css'), 'utf8');
  const theme = parseThemeBlocks(source);
  const css = generateTokensCss(theme);

  it('generates both themes with the scales and status colours the app consumes', () => {
    expect(css).toContain(":root[data-theme='light'] {");
    expect(css).toContain('--space-4: 16px');
    expect(css).toContain('--font-size-md: 14px');
    expect(css).toContain('--status-ready-fg');
  });

  it('leaves out the dashboard-only rules that follow the themes', () => {
    expect(css).not.toContain('.scanline');
    expect(css).not.toContain('prefers-reduced-motion');
    expect(css).not.toContain(':where(');
  });

  it('recomputes the accent channels for light', () => {
    const light = css.slice(css.indexOf(":root[data-theme='light'] {"));
    expect(light).toContain('--color-accent-rgb: 20 108 53;');
    expect(light).toContain('--color-on-accent-rgb: 255 255 255;');
  });

  it.each([
    ['dark', theme.dark],
    ['light', { ...theme.dark, ...theme.light }]
  ])('keeps text on the accent fill readable in %s', (_name, vars) => {
    const ratio = contrastRatio(resolveVar('--color-on-accent', vars), resolveVar('--color-accent', vars));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
