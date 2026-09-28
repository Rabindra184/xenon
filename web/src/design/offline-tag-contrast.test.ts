import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CSS = fs
  .readFileSync(path.resolve(__dirname, '../tokens.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Custom properties from every block whose selector passes `pick`, later blocks winning. */
function declared(pick: (selector: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, selector, body] of Array.from(CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g))) {
    if (!pick(selector.trim())) continue;
    for (const [, name, value] of Array.from(body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))) {
      out[name] = value.trim();
    }
  }
  return out;
}

const dark = declared((s) => s.includes(':root') && !s.includes('data-theme'));
const THEMES = {
  dark,
  light: { ...dark, ...declared((s) => s === ":root[data-theme='light']") },
};

function hex(vars: Record<string, string>, name: string): string {
  let v = vars[name];
  for (let m = /^var\((--[\w-]+)\)$/.exec(v); m; m = /^var\((--[\w-]+)\)$/.exec(v)) v = vars[m[1]];
  if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${name} resolves to ${v}, not a hex colour`);
  return v;
}

function luminance(h: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * An offline device's tags used to fade to 0.55 and measured 2.3-3.2:1. They
 * now take --status-offline-tag, on a card (--surface) and a table row (--bg,
 * or --surface-2 on hover), so it has to clear AA on all three in both themes.
 */
describe('--status-offline-tag', () => {
  for (const [theme, vars] of Object.entries(THEMES)) {
    it(`clears 4.5:1 on every surface an offline tag sits on (${theme})`, () => {
      const tag = hex(vars, '--status-offline-tag');
      const ratios = Object.fromEntries(
        ['--bg', '--surface', '--surface-2'].map((bg) => [
          bg,
          Number(contrast(tag, hex(vars, bg)).toFixed(2)),
        ]),
      );
      expect(Object.entries(ratios).filter(([, r]) => r < 4.5)).toEqual([]);
    });
  }
});

const CARD_CSS = fs
  .readFileSync(
    path.resolve(__dirname, '../components/device-card/device-card/device-card.css'),
    'utf8',
  )
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Declarations of the device-card rule whose selector list includes `selector`. */
function cardRule(selector: string): Record<string, string> {
  for (const [, selectors, body] of Array.from(CARD_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g))) {
    if (!selectors.split(',').some((s) => s.trim().replace(/\s+/g, ' ') === selector)) continue;
    return Object.fromEntries(
      Array.from(body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)).map(([, k, v]) => [k, v.trim()]),
    );
  }
  throw new Error(`device-card.css has no ${selector} rule`);
}

type Rgba = [number, number, number, number];

/** A colour value as the stylesheet writes it: hex, rgba(), rgb(var(--rgb-x) / a), color-mix with transparent. */
function rgba(vars: Record<string, string>, value: string): Rgba {
  const v = value.trim();
  let m = /^var\((--[\w-]+)\)$/.exec(v);
  if (m) return rgba(vars, vars[m[1]]);
  if (/^#[0-9a-f]{6}$/i.test(v))
    return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)).concat(1) as Rgba;
  m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(v);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  m = /^rgb\(var\((--[\w-]+)\)\s*\/\s*([\d.]+)\)$/.exec(v);
  if (m) return [...(vars[m[1]].split(/\s+/).map(Number) as [number, number, number]), +m[2]];
  m = /^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*transparent\)$/.exec(v);
  if (m) {
    const [r, g, b, a] = rgba(vars, m[1]);
    return [r, g, b, (a * +m[2]) / 100];
  }
  throw new Error(`cannot resolve colour ${value}`);
}

/** `top` painted over an opaque `under`, as hex. */
function over([r, g, b, a]: Rgba, under: string): string {
  const [R, G, B] = rgba({}, under);
  return `#${[r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)]
    .map((c) => Math.round(c).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * An offline card faded its whole team pill to 0.55, so the team's name
 * measured 2.95:1 (dark) and 2.32:1 (light) from computed colours. The pill
 * is now left out of the opacity fade and takes the offline tag colour for
 * its name, with its tint and border faded by the same 0.55 as the card's
 * picture. The name has to clear AA on that faded tint over the card, in
 * both themes.
 */
describe('an offline card’s team pill', () => {
  for (const [theme, vars] of Object.entries(THEMES)) {
    it(`clears 4.5:1 on its faded tint over the card (${theme})`, () => {
      const pill = cardRule('.dc2-dim .dc2-team');
      expect(pill.color).toBe('var(--status-offline-tag)');
      const tint = over(rgba(vars, pill['background-color']), hex(vars, '--surface'));
      const name = over(rgba(vars, pill.color), tint);
      expect(Number(contrast(name, tint).toFixed(2))).toBeGreaterThanOrEqual(4.5);
    });

    it(`keeps its tint and border faded like the picture (${theme})`, () => {
      const pill = cardRule('.dc2-dim .dc2-team');
      const fade = Number(cardRule('.dc2-dim .dc2-icon').opacity);
      const faded = (value: string, full: string) =>
        Number((rgba(vars, value)[3] / rgba(vars, full)[3]).toFixed(3));
      expect(faded(pill['background-color'], 'var(--accent-subtle)')).toBe(fade);
      expect(faded(pill['border-color'], 'var(--accent-border)')).toBe(fade);
    });
  }
});
