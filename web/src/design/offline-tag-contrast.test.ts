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
