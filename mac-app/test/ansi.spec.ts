import { describe, expect, it } from 'vitest';
import { parseAnsi } from '../src/renderer/src/ansi';

const ESC = '\x1b';

describe('parseAnsi', () => {
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
      { text: 'ok', color: '#4ec96f' },
      { text: ' done' }
    ]);
    expect(parseAnsi(`${ESC}[91mbad${ESC}[0m`)).toEqual([{ text: 'bad', color: '#ff6b6b' }]);
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
