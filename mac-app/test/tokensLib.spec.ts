import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain-JS build script lib, no types needed for these assertions.
import { COLOR_VARS, LIGHT_REQUIRED_VARS, MissingTokenError, SCALE_VARS, blend, contrastRatio, generateTokensCss, generateWindowBackgroundTs, hexToRgbChannels, parseThemeBlocks, resolveVar } from '../scripts/tokens-lib.mjs';
// @ts-expect-error — plain-JS Tailwind config, read here only for the token names it uses.
import tailwindConfig from '../tailwind.config.mjs';

/** A plausible value for a required token, so a fixture passes the missing-token check. */
const sampleValue = (name: string): string => {
  if (name === '--bg') return '#0e1013';
  if (name.startsWith('--space-') || name.startsWith('--radius-') || name.startsWith('--font-size-')) return '4px';
  if (name.startsWith('--shadow-')) return '0 1px 2px rgba(0, 0, 0, 0.25)';
  return '#123456';
};

/** One declaration per token the launcher consumes (colours and the scales Tailwind reads), less `omit`. */
const requiredDecls = (...omit: string[]): string =>
  [...(COLOR_VARS as string[]), ...(SCALE_VARS as string[])]
    .filter((name) => !omit.includes(name))
    .map((name) => `  ${name}: ${sampleValue(name)};`)
    .join('\n');

/** A light block with the tokens light must restate, less `omit`. */
const lightDecls = (omit?: string): string =>
  (LIGHT_REQUIRED_VARS as string[])
    .filter((name) => name !== omit)
    .map((name) => `  ${name}: ${name === '--bg' ? '#f6f7f9' : '#fefefe'};`)
    .join('\n');

const FIXTURE = `
/* Dark islands — a comment with braces { } and :root in it. */
.theme-dark,
:root {
  color-scheme: dark;
${requiredDecls('--space-1', '--black', '--font-size-md')}
  --space-1: 4px;
}

.theme-dark,
:root {
  --black: #000000;
  --font-size-md: 14px;
}

:root[data-theme='light'] {
  color-scheme: light;
${lightDecls()}
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
    expect(light).toEqual({ '--bg': '#f6f7f9', '--surface': '#fefefe', '--text': '#fefefe' });
    expect(light['--bg']).not.toBe(dark['--bg']);
  });

  it('ignores :where(), @media and every other selector', () => {
    for (const theme of [dark, light]) {
      expect(theme).not.toHaveProperty('--from-where');
      expect(theme).not.toHaveProperty('--from-legacy');
      expect(theme).not.toHaveProperty('--from-media');
    }
  });

  // Without these, light would quietly resolve to dark and every contrast test would still pass.
  it('throws when the file has no light block', () => {
    const css = `:root {\n${requiredDecls()}\n}`;
    expect(() => parseThemeBlocks(css)).toThrow(MissingTokenError);
    expect(() => parseThemeBlocks(css)).toThrow(/--bg.*light/);
  });

  it('throws when the light selector is renamed', () => {
    const css = `:root {\n${requiredDecls()}\n}\n.theme-light {\n${lightDecls()}\n}`;
    expect(() => parseThemeBlocks(css)).toThrow(MissingTokenError);
  });

  it.each(['--bg', '--surface', '--text'])('throws when the light block does not define %s', (name) => {
    const css = `:root {\n${requiredDecls()}\n}\n:root[data-theme='light'] {\n${lightDecls(name)}\n}`;
    expect(() => parseThemeBlocks(css)).toThrow(MissingTokenError);
    expect(() => parseThemeBlocks(css)).toThrow(new RegExp(`${name}\\b.*light`));
  });

  it('throws a named error when the dashboard drops a colour we consume', () => {
    const css = `:root {\n${requiredDecls('--bg')}\n}\n:root[data-theme='light'] {\n${lightDecls()}\n}`;
    expect(() => parseThemeBlocks(css)).toThrow(MissingTokenError);
    expect(() => parseThemeBlocks(css)).toThrow(/--bg/);
  });

  // A renamed scale would otherwise "succeed" and collapse the spacing or type to nothing.
  it.each(['--space-4', '--font-size-md', '--radius-md', '--shadow-md'])(
    'throws a named error when the dashboard drops the scale token %s',
    (name) => {
      const css = `:root {\n${requiredDecls(name)}\n}\n:root[data-theme='light'] {\n${lightDecls()}\n}`;
      expect(() => parseThemeBlocks(css)).toThrow(MissingTokenError);
      expect(() => parseThemeBlocks(css)).toThrow(new RegExp(`${name}\\b`));
    }
  );
});

describe('the tokens Tailwind reads', () => {
  /** Every `--name` inside a `var(...)` anywhere in the Tailwind theme. */
  const varsIn = (value: unknown): string[] => {
    if (typeof value === 'string') return [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
    if (Array.isArray(value)) return value.flatMap(varsIn);
    if (value && typeof value === 'object') return Object.values(value).flatMap(varsIn);
    return [];
  };
  const read = [...new Set(varsIn(tailwindConfig.theme))];

  it('finds the names (the walk itself works)', () => {
    expect(read).toContain('--space-4');
    expect(read).toContain('--bg-rgb');
    expect(read).toContain('--status-ready-fg');
  });

  it('are all guarded: each scale is in SCALE_VARS, each colour (or its -rgb channels) in COLOR_VARS', () => {
    const unguarded = read.filter((name) => {
      const base = name.endsWith('-rgb') ? name.slice(0, -'-rgb'.length) : name;
      return !(COLOR_VARS as string[]).includes(base) && !(SCALE_VARS as string[]).includes(name);
    });
    expect(unguarded).toEqual([]);
  });

  it('SCALE_VARS is exactly the non-colour names Tailwind reads, no more', () => {
    const scales = read.filter((name) => !name.endsWith('-rgb') && !name.startsWith('--status-'));
    expect([...(SCALE_VARS as string[])].sort()).toEqual(scales.sort());
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

describe('blend', () => {
  it('lays a colour over another at the given opacity', () => {
    expect(blend('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(blend('#ff0000', '#0000ff', 0.25)).toBe('#4000bf');
  });

  it('is the background at 0 and the colour at 1', () => {
    expect(blend('#22c55e', '#0e1013', 0)).toBe('#0e1013');
    expect(blend('#22c55e', '#0e1013', 1)).toBe('#22c55e');
  });

  it('reads 3-digit hex and refuses anything else', () => {
    expect(blend('#fff', '#000', 1)).toBe('#ffffff');
    expect(() => blend('rgb(1 2 3)', '#000000', 0.1)).toThrow(/hex/);
    expect(() => blend('#000000', '#ffffff', 1.5)).toThrow(/alpha/);
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

describe('generateWindowBackgroundTs', () => {
  it('marks the file as generated so nobody hand-edits it', () => {
    const ts = generateWindowBackgroundTs({ dark: { '--bg': '#0e1013' }, light: { '--bg': '#f6f7f9' } });
    expect(ts).toMatch(/GENERATED/);
    expect(ts).toMatch(/sync:tokens/);
  });

  it("exports each theme's --bg, which the page itself paints", () => {
    const ts = generateWindowBackgroundTs({ dark: { '--bg': '#0e1013' }, light: { '--bg': '#f6f7f9' } });
    expect(ts).toContain("export const WINDOW_BACKGROUND = { dark: '#0e1013', light: '#f6f7f9' } as const;");
  });

  it('follows var() references, and light falls back to dark for what it does not restate', () => {
    const ts = generateWindowBackgroundTs({
      dark: { '--black': '#000000', '--bg': 'var(--black)' },
      light: { '--white': '#ffffff', '--bg': 'var(--white)' }
    });
    expect(ts).toContain("{ dark: '#000000', light: '#ffffff' }");
  });

  it('refuses a --bg that is not a plain colour, which a window cannot take', () => {
    expect(() =>
      generateWindowBackgroundTs({ dark: { '--bg': 'rgb(var(--x) / 0.5)' }, light: { '--bg': '#ffffff' } })
    ).toThrow(/--bg/);
  });

  it("matches the committed src/shared/windowBackground.ts for the dashboard's tokens", () => {
    const source = readFileSync(resolve(__dirname, '../../web/src/tokens.css'), 'utf8');
    const committed = readFileSync(resolve(__dirname, '../src/shared/windowBackground.ts'), 'utf8');
    expect(committed).toBe(generateWindowBackgroundTs(parseThemeBlocks(source)));
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
