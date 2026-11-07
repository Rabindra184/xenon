import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Light mode has to read clearly, not only pass AA. Through 2.19 every text
 * colour passed, yet the theme looked washed out: a card's border was 1.25:1
 * on white, the page 1.07:1 from the cards, and most text was 12px. These
 * floors keep a later tweak from fading it again.
 */
const CSS = fs
  .readFileSync(path.resolve(__dirname, '../tokens.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

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
const light = { ...dark, ...declared((s) => s === ":root[data-theme='light']") };

type Rgb = [number, number, number];

function hex(name: string): Rgb {
  let v = light[name];
  for (let m = /^var\((--[\w-]+)\)$/.exec(v); m; m = /^var\((--[\w-]+)\)$/.exec(v)) v = light[m[1]];
  if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${name} resolves to ${v}, not a hex colour`);
  return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as Rgb;
}

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (c: Rgb) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** `c` at `alpha` over `under`, as the browser blends a tint. */
const over = (c: Rgb, alpha: number, under: Rgb) =>
  c.map((v, i) => v * alpha + under[i] * (1 - alpha)) as Rgb;
const px = (name: string) => parseFloat(light[name]);

describe('light theme legibility', () => {
  const grounds = ['--surface', '--bg', '--surface-2'];

  it('every text colour clears 4.5:1 on each ground', () => {
    const low: string[] = [];
    for (const text of ['--text', '--text-muted', '--text-dim', '--text-placeholder']) {
      for (const ground of grounds) {
        const r = contrast(hex(text), hex(ground));
        if (r < 4.5) low.push(`${text} on ${ground}: ${r.toFixed(2)}`);
      }
    }
    expect(low).toEqual([]);
  });

  it('secondary text stays well clear of the floor, since most of it is small', () => {
    expect(contrast(hex('--text-muted'), hex('--surface'))).toBeGreaterThanOrEqual(9);
    expect(contrast(hex('--text-dim'), hex('--surface'))).toBeGreaterThanOrEqual(7);
  });

  it('cards, rules and controls have edges you can see', () => {
    expect(contrast(hex('--surface'), hex('--bg'))).toBeGreaterThanOrEqual(1.12);
    expect(contrast(hex('--border'), hex('--surface'))).toBeGreaterThanOrEqual(1.35);
    expect(contrast(hex('--border'), hex('--bg'))).toBeGreaterThanOrEqual(1.2);
    expect(contrast(hex('--border-strong'), hex('--surface'))).toBeGreaterThanOrEqual(1.8);
  });

  it('each status colour reads as text on its own 10% tint (a pill)', () => {
    const white = hex('--surface');
    const low: string[] = [];
    for (const role of [
      '--color-accent',
      '--color-success',
      '--color-warning',
      '--color-danger',
      '--color-info',
    ]) {
      const c = hex(role);
      const r = contrast(c, over(c, 0.1, white));
      if (r < 4.5) low.push(`${role}: ${r.toFixed(2)}`);
    }
    expect(low).toEqual([]);
  });

  it('the smallest text roles are 13px', () => {
    expect(px('--type-caption-size')).toBeGreaterThanOrEqual(13);
    expect(px('--type-mono-size')).toBeGreaterThanOrEqual(13);
  });
});
