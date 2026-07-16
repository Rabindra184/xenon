import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain-JS build script lib, no types needed for these assertions.
import { generateTokensCss, hexToRgbChannels, parseCssVars } from '../scripts/tokens-lib.mjs';

const WEB_TOKENS = `
/* Xenon design tokens — reference palette. */
:root {
  --bg: #0a0d0c;
  --surface: #111514;
  --green: #22c55e;
  --accent-subtle: rgba(34, 197, 94, 0.1);
  /* Spacing (4px grid) */
  --space-1: 4px;
}
.something-else { --bg: #ffffff; }
`;

describe('parseCssVars', () => {
  it('reads variables from the :root block only', () => {
    const vars = parseCssVars(WEB_TOKENS);
    expect(vars['--bg']).toBe('#0a0d0c');
    expect(vars['--green']).toBe('#22c55e');
    expect(vars['--accent-subtle']).toBe('rgba(34, 197, 94, 0.1)');
    expect(vars['--space-1']).toBe('4px');
  });

  it('does not pick up vars from other selectors', () => {
    // .something-else also defines --bg: #ffffff — :root must win.
    expect(parseCssVars(WEB_TOKENS)['--bg']).toBe('#0a0d0c');
  });

  it('returns an empty map when there is no :root block', () => {
    expect(parseCssVars('.a { color: red; }')).toEqual({});
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

describe('generateTokensCss', () => {
  const vars = { '--bg': '#0a0d0c', '--green': '#22c55e', '--accent-subtle': 'rgba(34, 197, 94, 0.1)' };

  it('emits each colour with an rgb-channel companion for Tailwind alpha', () => {
    const css = generateTokensCss(vars, { colors: ['--bg', '--green'], passthrough: [] });
    expect(css).toContain('--bg: #0a0d0c;');
    expect(css).toContain('--bg-rgb: 10 13 12;');
    expect(css).toContain('--green-rgb: 34 197 94;');
  });

  it('passes non-hex values through without an rgb companion', () => {
    const css = generateTokensCss(vars, { colors: ['--bg'], passthrough: ['--accent-subtle'] });
    expect(css).toContain('--accent-subtle: rgba(34, 197, 94, 0.1);');
    expect(css).not.toContain('--accent-subtle-rgb');
  });

  it('marks the file as generated so nobody hand-edits it', () => {
    const css = generateTokensCss(vars, { colors: ['--bg'], passthrough: [] });
    expect(css).toMatch(/generated/i);
    expect(css).toMatch(/sync:tokens/);
  });

  it('throws a named error when the dashboard drops a token we consume', () => {
    expect(() => generateTokensCss(vars, { colors: ['--bg', '--missing'], passthrough: [] })).toThrow(/--missing/);
  });
});
