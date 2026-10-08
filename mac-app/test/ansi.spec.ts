import { describe, expect, it } from 'vitest';
import { parseAnsi, stripAnsi } from '../src/renderer/src/ansi';

const ESC = '\x1b';

describe('parseAnsi', () => {
  it('colors red text with the --red token', () => {
    expect(parseAnsi(`${ESC}[31mred${ESC}[0m`)).toEqual([{ text: 'red', color: 'var(--red)' }]);
  });

  it('returns plain text as a single uncolored segment', () => {
    expect(parseAnsi('hello world')).toEqual([{ text: 'hello world' }]);
  });

  it('colors a 256-color (38;5;n) segment with a theme token and resets on [0m', () => {
    // The exact shape Appium/Xenon logs emit: xterm-256 color 120 is a light green.
    expect(parseAnsi(`${ESC}[38;5;120m[xenon]${ESC}[0m ready`)).toEqual([
      { text: '[xenon]', color: 'var(--green)' },
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

  // R6: a hex colour would not follow light and dark, so every extended colour is the nearest of the
  // eight theme tokens the 16 base colors use.
  describe('extended colors map to the nearest theme token', () => {
    const color = (code: string) => parseAnsi(`${ESC}[${code}mx${ESC}[0m`)[0].color;

    it('maps 256-color cube colors by hue', () => {
      expect(color('38;5;120')).toBe('var(--green)'); // light green
      expect(color('38;5;46')).toBe('var(--green)'); // pure green
      expect(color('38;5;28')).toBe('var(--green)'); // dark green
      expect(color('38;5;196')).toBe('var(--red)');
      expect(color('38;5;160')).toBe('var(--red)'); // darker red
      expect(color('38;5;210')).toBe('var(--red)'); // salmon
      expect(color('38;5;208')).toBe('var(--amber)'); // orange
      expect(color('38;5;226')).toBe('var(--amber)'); // yellow
      expect(color('38;5;33')).toBe('var(--blue)'); // azure
      expect(color('38;5;21')).toBe('var(--blue)');
      expect(color('38;5;201')).toBe('var(--blue-400)'); // magenta
      expect(color('38;5;51')).toBe('var(--sky-400)'); // cyan
    });

    it('maps the grayscale ramp (232–255) to the dim or the plain text color', () => {
      for (let n = 232; n <= 255; n++) {
        expect(['var(--text-dim)', 'var(--text)']).toContain(color(`38;5;${n}`));
      }
      expect(color('38;5;232')).toBe('var(--text-dim)'); // near black
      expect(color('38;5;240')).toBe('var(--text-dim)'); // mid dark gray, the usual "dim" text
      expect(color('38;5;255')).toBe('var(--text)'); // near white
    });

    it('maps the cube corners black and white to the dim and plain text colors', () => {
      expect(color('38;5;16')).toBe('var(--text-dim)');
      expect(color('38;5;231')).toBe('var(--text)');
    });

    it('never emits a hex or rgb() color, for any of the 256 colors', () => {
      const TOKEN = /^var\(--(red|green|amber|blue|blue-400|sky-400|text|text-dim)\)$/;
      for (let n = 0; n <= 255; n++) {
        expect(color(`38;5;${n}`), `38;5;${n}`).toMatch(TOKEN);
      }
    });

    it('maps 24-bit colors (38;2;r;g;b) the same way', () => {
      expect(color('38;2;255;0;0')).toBe('var(--red)');
      expect(color('38;2;135;255;135')).toBe('var(--green)');
      expect(color('38;2;250;180;20')).toBe('var(--amber)');
      expect(color('38;2;20;40;250')).toBe('var(--blue)');
      expect(color('38;2;40;220;240')).toBe('var(--sky-400)');
      expect(color('38;2;120;120;120')).toBe('var(--text-dim)');
      expect(color('38;2;240;240;240')).toBe('var(--text)');
    });

    it('keeps the color it had when an extended color is out of range or cut short', () => {
      expect(parseAnsi(`${ESC}[31m${ESC}[38;5;300mx`)).toEqual([{ text: 'x', color: 'var(--red)' }]);
      expect(parseAnsi(`${ESC}[31m${ESC}[38;2;999;0;0mx`)).toEqual([{ text: 'x', color: 'var(--red)' }]);
      expect(parseAnsi(`${ESC}[38;2;10mx`)).toEqual([{ text: 'x' }]);
    });

    it('does not read a background color (48;…) as a foreground color', () => {
      // 48;5;32 sets a background; the 32 in it is not "green text".
      expect(parseAnsi(`${ESC}[48;5;32mx${ESC}[0m`)).toEqual([{ text: 'x' }]);
      expect(parseAnsi(`${ESC}[48;2;0;255;0mx${ESC}[0m`)).toEqual([{ text: 'x' }]);
    });

    it('goes on to the codes after an extended color in the same sequence', () => {
      expect(parseAnsi(`${ESC}[38;5;196;1mx`)).toEqual([{ text: 'x', color: 'var(--red)' }]);
      expect(parseAnsi(`${ESC}[1;38;2;255;0;0;4mx`)).toEqual([{ text: 'x', color: 'var(--red)' }]);
      expect(parseAnsi(`${ESC}[38;5;196;32mx`)).toEqual([{ text: 'x', color: 'var(--green)' }]);
    });
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

describe('stripAnsi', () => {
  it('removes color and other escape sequences, keeping the words', () => {
    expect(stripAnsi(`${ESC}[31mred${ESC}[0m and ${ESC}[2Kplain`)).toBe('red and plain');
    expect(stripAnsi(`${ESC}[38;5;120m[xenon]${ESC}[0m ready`)).toBe('[xenon] ready');
  });

  it('leaves text without escapes as it is', () => {
    expect(stripAnsi('hello [31m world')).toBe('hello [31m world');
    expect(stripAnsi('')).toBe('');
  });

  it('gives the same words as the segments of parseAnsi', () => {
    const text = `${ESC}[38;5;120mA${ESC}[0m ${ESC}[1Gb${ESC}[4mc`;
    expect(stripAnsi(text)).toBe(parseAnsi(text).map((s) => s.text).join(''));
  });
});
