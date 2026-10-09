import { describe, expect, it } from 'vitest';
import { parseAnsi } from '../src/renderer/src/ansi';

const ESC = '\x1b';

describe('parseAnsi', () => {
  it('colors red text with the --red token', () => {
    expect(parseAnsi(`${ESC}[31mred${ESC}[0m`)).toEqual([{ text: 'red', color: 'var(--red)' }]);
  });

  it('returns plain text as a single uncolored segment', () => {
    expect(parseAnsi('hello world')).toEqual([{ text: 'hello world' }]);
  });

  it('colors a 256-color (38;5;n) segment and resets on [0m', () => {
    // The exact shape Appium/Xenon logs emit: xterm-256 color 120 = #87ff87.
    expect(parseAnsi(`${ESC}[38;5;120m[xenon]${ESC}[0m ready`)).toEqual([
      { text: '[xenon]', color: '#87ff87' },
      { text: ' ready' }
    ]);
  });

  it('supports basic (30–37) and bright (90–97) foreground colors', () => {
    expect(parseAnsi(`${ESC}[32mok${ESC}[39m done`)).toEqual([
      { text: 'ok', color: 'var(--green)' },
      { text: ' done' }
    ]);
    expect(parseAnsi(`${ESC}[91mbad${ESC}[0m`)).toEqual([{ text: 'bad', color: 'var(--red)' }]);
  });

  it('colors the 16 base colors with theme tokens, so they follow light and dark', () => {
    const TOKENS: Record<number, string> = {
      30: 'var(--text-dim)',
      31: 'var(--red)',
      32: 'var(--green)',
      33: 'var(--amber)',
      34: 'var(--blue)',
      35: 'var(--blue-400)',
      36: 'var(--sky-400)',
      37: 'var(--text)'
    };
    for (const [code, token] of Object.entries(TOKENS)) {
      const normal = Number(code);
      expect(parseAnsi(`${ESC}[${normal}mx${ESC}[0m`)).toEqual([{ text: 'x', color: token }]);
      // Bright variants (90–97) use the same token as their normal color.
      expect(parseAnsi(`${ESC}[${normal + 60}mx${ESC}[0m`)).toEqual([{ text: 'x', color: token }]);
    }
  });

  it('maps the first 16 xterm-256 colors to the same tokens', () => {
    expect(parseAnsi(`${ESC}[38;5;1mred${ESC}[0m`)).toEqual([{ text: 'red', color: 'var(--red)' }]);
    expect(parseAnsi(`${ESC}[38;5;10mgreen${ESC}[0m`)).toEqual([{ text: 'green', color: 'var(--green)' }]);
  });

  it('maps the 256-color grayscale ramp (232–255)', () => {
    expect(parseAnsi(`${ESC}[38;5;240mdim${ESC}[0m`)).toEqual([{ text: 'dim', color: '#585858' }]);
  });

  it('strips non-color CSI sequences (cursor moves, erase-line)', () => {
    expect(parseAnsi(`${ESC}[2Kcleared${ESC}[1Gline`)).toEqual([{ text: 'clearedline' }]);
  });

  it('ignores unknown SGR codes but keeps the text', () => {
    expect(parseAnsi(`${ESC}[4munderlined${ESC}[0m`)).toEqual([{ text: 'underlined' }]);
  });

  it('does not treat bare bracket text as an escape sequence', () => {
    expect(parseAnsi('[38;5;120m looks like ansi but has no ESC')).toEqual([
      { text: '[38;5;120m looks like ansi but has no ESC' }
    ]);
  });

  it('returns an empty array for an empty string', () => {
    expect(parseAnsi('')).toEqual([]);
  });
});
