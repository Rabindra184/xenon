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

type Rgb = [number, number, number];

function hex(vars: Record<string, string>, name: string): Rgb {
  let v = vars[name];
  for (let m = /^var\((--[\w-]+)\)$/.exec(v); m; m = /^var\((--[\w-]+)\)$/.exec(v)) v = vars[m[1]];
  if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${name} resolves to ${v}, not a hex colour`);
  return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as Rgb;
}

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const unlin = (c: number) => {
  const x = Math.min(1, Math.max(0, c));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
};
const luminance = (c: Rgb) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Machado, Oliveira & Fernandes (2009), full severity, on linear RGB. */
const VISION: Record<string, number[][]> = {
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

function seenBy(c: Rgb, m: number[][]): Rgb {
  const l = c.map(lin);
  return m.map((row) => unlin(row[0] * l[0] + row[1] * l[1] + row[2] * l[2])) as Rgb;
}

/** CIE L*a*b* (D65). */
function lab(c: Rgb): Rgb {
  const [r, g, b] = c.map(lin);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const deltaE = (a: Rgb, b: Rgb) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

const SERIES = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'];

/**
 * The chart series, as the comment beside them in tokens.css promises: each
 * one visible on a card (3:1, WCAG 1.4.11 for graphics), and every pair told
 * apart with each common colour-vision deficiency, not only with full colour.
 */
describe('chart palette', () => {
  for (const [theme, vars] of Object.entries(THEMES)) {
    it(`each series clears 3:1 on --surface (${theme})`, () => {
      const surface = hex(vars, '--surface');
      const low = SERIES.map((s) => [s, Number(contrast(hex(vars, s), surface).toFixed(2))]).filter(
        ([, r]) => (r as number) < 3,
      );
      expect(low).toEqual([]);
    });

    for (const [vision, m] of Object.entries(VISION)) {
      it(`every pair stays apart (ΔE >= 13) with ${vision} (${theme})`, () => {
        const close: string[] = [];
        for (let i = 0; i < SERIES.length; i++)
          for (let j = i + 1; j < SERIES.length; j++) {
            const d = deltaE(seenBy(hex(vars, SERIES[i]), m), seenBy(hex(vars, SERIES[j]), m));
            if (d < 13) close.push(`${SERIES[i]} / ${SERIES[j]}: ${d.toFixed(1)}`);
          }
        expect(close).toEqual([]);
      });
    }
  }
});
